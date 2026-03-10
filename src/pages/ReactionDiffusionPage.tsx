import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import rdComputeCode from '../shaders/reaction_diffusion.wgsl?raw';
import rdRenderCode from '../shaders/rd_render.wgsl?raw';

const GRID = 512;
const CELL_COUNT = GRID * GRID;

type RDPreset = 'coral' | 'mitosis' | 'waves' | 'spots' | 'maze';
const PRESETS: Record<RDPreset, { feed: number; kill: number; label: string }> = {
  coral:   { feed: 0.0545, kill: 0.062, label: 'Coral' },
  mitosis: { feed: 0.0367, kill: 0.0649, label: 'Mitosis' },
  waves:   { feed: 0.014, kill: 0.054, label: 'Waves' },
  spots:   { feed: 0.03, kill: 0.062, label: 'Spots' },
  maze:    { feed: 0.029, kill: 0.057, label: 'Maze' },
};

function initGrid(): Float32Array<ArrayBuffer> {
  const data = new Float32Array(CELL_COUNT * 2);
  for (let i = 0; i < CELL_COUNT; i++) {
    data[i * 2] = 1.0; // A = 1
    data[i * 2 + 1] = 0.0; // B = 0
  }
  // Seed center area
  const cx = GRID / 2, cy = GRID / 2;
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const idx = ((cy + dy) * GRID + (cx + dx)) * 2;
      data[idx + 1] = 1.0;
    }
  }
  return data;
}

export const ReactionDiffusionPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    gridBuffers: GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    currentBuffer: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const [preset, setPreset] = useState<RDPreset>('coral');
  const [paused, setPaused] = useState(false);
  const [colorMode, setColorMode] = useState(0);
  const [stepsPerFrame, setStepsPerFrame] = useState(8);
  const [fps, setFps] = useState(0);
  const paramsRef = useRef({ feed: 0.0545, kill: 0.062, paused: false, colorMode: 0, steps: 8 });
  const mouseRef = useRef({ x: 0, y: 0, pressed: false });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: rdComputeCode });
    const renderModule = device.createShaderModule({ code: rdRenderCode });

    const bufSize = CELL_COUNT * 8; // 2 floats per cell
    const gridBuffers = [0, 1].map(() => device.createBuffer({
      size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const data = initGrid();
    device.queue.writeBuffer(gridBuffers[0], 0, data);
    device.queue.writeBuffer(gridBuffers[1], 0, data);

    const computeUB = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderUB = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const cBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const computeBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: cBGL,
      entries: [
        { binding: 0, resource: { buffer: computeUB } },
        { binding: 1, resource: { buffer: gridBuffers[i] } },
        { binding: 2, resource: { buffer: gridBuffers[1 - i] } },
      ],
    }));
    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [cBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    const rBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const renderBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: rBGL,
      entries: [
        { binding: 0, resource: { buffer: renderUB } },
        { binding: 1, resource: { buffer: gridBuffers[i] } },
      ],
    }));
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [rBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext, computePipeline, renderPipeline,
      gridBuffers, computeUniformBuffer: computeUB, renderUniformBuffer: renderUB,
      computeBindGroups, renderBindGroups, currentBuffer: 0,
    };
  }, []);

  const resetGrid = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const data = initGrid();
    gpu.device.queue.writeBuffer(gpu.gridBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.gridBuffers[1], 0, data);
    gpu.currentBuffer = 0;
  }, []);

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const p = paramsRef.current;
    const m = mouseRef.current;

    // Compute uniforms
    const cu = new Float32Array(12);
    const cu32 = new Uint32Array(cu.buffer);
    cu32[0] = GRID; cu32[1] = GRID;
    cu[2] = p.feed; cu[3] = p.kill;
    cu[4] = 1.0; cu[5] = 0.5; // dA, dB
    cu[6] = 1.0; // dt
    cu32[7] = p.paused ? 1 : 0;
    cu[8] = m.x; cu[9] = m.y;
    cu32[10] = m.pressed ? 1 : 0;
    cu32[11] = 8; // brush size
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Render uniforms
    const ru = new Uint32Array([GRID, GRID, p.colorMode, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const encoder = gpu.device.createCommandEncoder();

    const steps = p.paused ? 0 : p.steps;
    for (let s = 0; s < steps; s++) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(gpu.computePipeline);
      cp.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
      cp.dispatchWorkgroups(Math.ceil(GRID / 16), Math.ceil(GRID / 16));
      cp.end();
      gpu.currentBuffer = 1 - gpu.currentBuffer;
    }

    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
    });
    rp.setPipeline(gpu.renderPipeline);
    rp.setBindGroup(0, gpu.renderBindGroups[gpu.currentBuffer]);
    rp.draw(4);
    rp.end();

    gpu.device.queue.submit([encoder.finish()]);

    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
      fpsFrames.current = 0; fpsTime.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseRef.current.x = (e.clientX - r.left) / r.width;
      mouseRef.current.y = 1 - (e.clientY - r.top) / r.height;
    };
    const onDown = () => { mouseRef.current.pressed = true; };
    const onUp = () => { mouseRef.current.pressed = false; };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false; cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      if (gpuRef.current) {
        gpuRef.current.gridBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const p = PRESETS[preset];
    paramsRef.current.feed = p.feed;
    paramsRef.current.kill = p.kill;
  }, [preset]);
  useEffect(() => { paramsRef.current.paused = paused; }, [paused]);
  useEffect(() => { paramsRef.current.colorMode = colorMode; }, [colorMode]);
  useEffect(() => { paramsRef.current.steps = stepsPerFrame; }, [stepsPerFrame]);

  const colors = ['Teal/Coral', 'Purple/Gold', 'Grayscale', 'Infrared'];

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Reaction-Diffusion</h1>
            <span className="badge">{preset}</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
            </div>
          </div>
        </header>
        <aside className="ui-controls">
          <div className="control-group">
            <label>Pattern</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {(Object.entries(PRESETS) as [RDPreset, typeof PRESETS.coral][]).map(([k, v]) => (
                <button key={k} className={`preset-btn ${preset === k ? 'active' : ''}`}
                  onClick={() => { setPreset(k); resetGrid(); }}>
                  <span className="preset-label">{v.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {colors.map((c, i) => (
                <button key={c} className={`preset-btn ${colorMode === i ? 'active' : ''}`}
                  onClick={() => setColorMode(i)}>
                  <span className="preset-label">{c}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Speed <span className="value">{stepsPerFrame} steps/frame</span></label>
            <input type="range" min="1" max="32" step="1" value={stepsPerFrame}
              onChange={e => setStepsPerFrame(Number(e.target.value))} />
          </div>
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetGrid}>↻ Reset</button>
            <button className="action-btn" onClick={() => {
              const c = canvasRef.current;
              if (!c) return;
              const a = document.createElement('a');
              a.download = `rd-${preset}-${Date.now()}.png`;
              a.href = c.toDataURL('image/png'); a.click();
            }}>📷</button>
          </div>
          <div className="hints">
            <span>Click/drag to seed chemical B</span>
            <span>Gray-Scott model · {GRID}x{GRID} grid</span>
          </div>
        </aside>
      </div>
    </div>
  );
};
