import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';
import leniaComputeCode from '../shaders/lenia_compute.wgsl?raw';
import leniaRenderCode from '../shaders/lenia_render.wgsl?raw';

const GRID = 256;
const CELL_COUNT = GRID * GRID;

type LeniaPreset = 'Orbium' | 'Gyromorphosis' | 'Hydrogeminium' | 'Scutium';
const PRESETS: Record<LeniaPreset, { mu: number; sigma: number; R: number; dt: number; label: string }> = {
  Orbium:        { mu: 0.15,  sigma: 0.017, R: 13, dt: 0.1,  label: 'Orbium' },
  Gyromorphosis: { mu: 0.26,  sigma: 0.036, R: 13, dt: 0.1,  label: 'Gyro' },
  Hydrogeminium: { mu: 0.46,  sigma: 0.048, R: 13, dt: 0.08, label: 'Hydro' },
  Scutium:       { mu: 0.177, sigma: 0.018, R: 13, dt: 0.12, label: 'Scutium' },
};

function initGrid(_preset: LeniaPreset): ArrayBuffer {
  const buf = new ArrayBuffer(CELL_COUNT * 4);
  const f32 = new Float32Array(buf);
  // Seed a circular patch in the center with random values
  const cx = GRID / 2, cy = GRID / 2;
  const r = 20;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) {
        f32[y * GRID + x] = Math.random() > 0.5 ? Math.random() : 0;
      }
    }
  }
  return buf;
}

export const LeniaPage: React.FC = () => {
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
  const [preset, setPreset] = useState<LeniaPreset>('Orbium');
  const [colorMode, setColorMode] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const paramsRef = useRef({ mu: 0.15, sigma: 0.017, R: 13, dt: 0.1, colorMode: 0, paused: false });
  const mouseRef = useRef({ x: 0, y: 0, pressed: false });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);
  const presetRef = useRef<LeniaPreset>('Orbium');

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: leniaComputeCode });
    const renderModule = device.createShaderModule({ code: leniaRenderCode });

    const bufSize = CELL_COUNT * 4; // f32 per cell
    const gridBuffers = [0, 1].map(() => device.createBuffer({
      size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const data = initGrid(presetRef.current);
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
    const data = initGrid(presetRef.current);
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

    // Compute uniforms: 48 bytes = 12 slots
    const cu = new Float32Array(12);
    const cu32 = new Uint32Array(cu.buffer);
    cu32[0] = GRID; cu32[1] = GRID;
    cu[2] = p.R;       // radius
    cu[3] = p.mu;      // mu
    cu[4] = p.sigma;   // sigma
    cu[5] = p.dt;      // dt
    cu[6] = m.x;       // mouseX
    cu[7] = m.y;       // mouseY
    cu32[8] = m.pressed ? 1 : 0; // mouseActive
    cu32[9] = 8;       // brushSize
    cu32[10] = 0; cu32[11] = 0;
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Render uniforms: 16 bytes
    const ru = new Uint32Array([GRID, GRID, p.colorMode, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const encoder = gpu.device.createCommandEncoder();

    if (!p.paused) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(gpu.computePipeline);
      cp.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
      cp.dispatchWorkgroups(Math.ceil(GRID / 16), Math.ceil(GRID / 16));
      cp.end();
      // Ping-pong: swap AFTER compute, BEFORE render
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
      mouseRef.current.y = (e.clientY - r.top) / r.height;
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
    paramsRef.current.mu = p.mu;
    paramsRef.current.sigma = p.sigma;
    paramsRef.current.R = p.R;
    paramsRef.current.dt = p.dt;
    presetRef.current = preset;
  }, [preset]);
  useEffect(() => { paramsRef.current.paused = paused; }, [paused]);
  useEffect(() => { paramsRef.current.colorMode = colorMode; }, [colorMode]);

  useSimKeyboard({
    onPause: () => setPaused(v => !v),
    onReset: () => { resetGrid(); },
    onScreenshot: () => {
      const c = canvasRef.current;
      if (!c) return;
      const a = document.createElement('a');
      a.download = `lenia-${preset}-${Date.now()}.png`;
      a.href = c.toDataURL('image/png'); a.click();
    },
  });

  const colorModes = ['Viridis', 'Alien', 'Gold'];

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Lenia</h1>
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
            <label>Species</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {(Object.entries(PRESETS) as [LeniaPreset, typeof PRESETS.Orbium][]).map(([k, v]) => (
                <button key={k} className={`preset-btn ${preset === k ? 'active' : ''}`}
                  onClick={() => { setPreset(k); const p = PRESETS[k]; paramsRef.current.mu = p.mu; paramsRef.current.sigma = p.sigma; paramsRef.current.R = p.R; paramsRef.current.dt = p.dt; presetRef.current = k; resetGrid(); }}>
                  <span className="preset-label">{v.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {colorModes.map((c, i) => (
                <button key={c} className={`preset-btn ${colorMode === i ? 'active' : ''}`}
                  onClick={() => setColorMode(i)}>
                  <span className="preset-label">{c}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(v => !v)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetGrid}>↻ Reset</button>
            <button className="action-btn" onClick={() => {
              const c = canvasRef.current;
              if (!c) return;
              const a = document.createElement('a');
              a.download = `lenia-${preset}-${Date.now()}.png`;
              a.href = c.toDataURL('image/png'); a.click();
            }}>📷</button>
            <ShareButton canvasRef={canvasRef} title="Lenia" />
          </div>
          <div className="hints">
            <span>Click to seed living cells · 256×256 grid · toroidal wrapping</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay id="lenia" steps={[
        { icon: '🧬', title: 'Lenia', desc: '연속 셀룰러 오토마타 — 생명체처럼 움직입니다' },
        { icon: '🔬', title: '커널', desc: '링 모양 커널로 주변을 감지, 성장 함수로 진화' },
        { icon: '🌿', title: '종류', desc: 'Orbium(구형), Gyro(회전), Hydro, Scutium 4종' },
        { icon: '🖱️', title: '클릭', desc: '빈 곳을 클릭하여 세포를 심어보세요' },
      ]} onClose={() => {}} />
    </div>
  );
};
