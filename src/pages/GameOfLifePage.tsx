import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import golComputeCode from '../shaders/gol_compute.wgsl?raw';
import golRenderCode from '../shaders/gol_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const GRID_W = 512;
const GRID_H = 512;
const CELL_COUNT = GRID_W * GRID_H;

type Pattern = 'random' | 'glider-gun' | 'pulsar' | 'clear';

function createPattern(pattern: Pattern): Uint32Array<ArrayBuffer> {
  const data = new Uint32Array(CELL_COUNT);
  if (pattern === 'random') {
    for (let i = 0; i < CELL_COUNT; i++) {
      data[i] = Math.random() > 0.7 ? 1 : 0;
    }
  } else if (pattern === 'glider-gun') {
    // Gosper glider gun at (10, 10)
    const pts = [
      [1,5],[1,6],[2,5],[2,6],
      [11,5],[11,6],[11,7],[12,4],[12,8],[13,3],[13,9],[14,3],[14,9],
      [15,6],[16,4],[16,8],[17,5],[17,6],[17,7],[18,6],
      [21,3],[21,4],[21,5],[22,3],[22,4],[22,5],[23,2],[23,6],[25,1],[25,2],[25,6],[25,7],
      [35,3],[35,4],[36,3],[36,4],
    ];
    const ox = 10, oy = Math.floor(GRID_H / 2) - 5;
    for (const [x, y] of pts) {
      const idx = (oy + y) * GRID_W + (ox + x);
      if (idx >= 0 && idx < CELL_COUNT) data[idx] = 1;
    }
  } else if (pattern === 'pulsar') {
    const cx = Math.floor(GRID_W / 2);
    const cy = Math.floor(GRID_H / 2);
    const offsets = [
      [-6,-4],[-6,-3],[-6,-2],[-6,2],[-6,3],[-6,4],
      [-4,-6],[-3,-6],[-2,-6],[-4,-1],[-3,-1],[-2,-1],
      [-4,1],[-3,1],[-2,1],[-4,6],[-3,6],[-2,6],
      [-1,-4],[-1,-3],[-1,-2],[-1,2],[-1,3],[-1,4],
      [1,-4],[1,-3],[1,-2],[1,2],[1,3],[1,4],
      [2,-6],[3,-6],[4,-6],[2,-1],[3,-1],[4,-1],
      [2,1],[3,1],[4,1],[2,6],[3,6],[4,6],
      [6,-4],[6,-3],[6,-2],[6,2],[6,3],[6,4],
    ];
    for (const [dx, dy] of offsets) {
      const idx = (cy + dy) * GRID_W + (cx + dx);
      if (idx >= 0 && idx < CELL_COUNT) data[idx] = 1;
    }
  }
  return data;
}

export const GameOfLifePage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    cellBuffers: GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    currentBuffer: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const [paused, setPaused] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);
  const [fps, setFps] = useState(0);
  const [speed, setSpeed] = useState(1); // steps per frame
  const pausedRef = useRef(false);
  const colorRef = useRef(0);
  const speedRef = useRef(1);
  const genRef = useRef(0);
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);
  const drawingRef = useRef(false);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: golComputeCode });
    const renderModule = device.createShaderModule({ code: golRenderCode });

    const bufferSize = CELL_COUNT * 4;
    const cellBuffers = [0, 1].map(() => device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const initialData = createPattern('random');
    device.queue.writeBuffer(cellBuffers[0], 0, initialData);
    device.queue.writeBuffer(cellBuffers[1], 0, initialData);

    const computeUniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderUniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Compute
    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const computeBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: computeUniformBuffer } },
        { binding: 1, resource: { buffer: cellBuffers[i] } },
        { binding: 2, resource: { buffer: cellBuffers[1 - i] } },
      ],
    }));
    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    // Render
    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const renderBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: renderUniformBuffer } },
        { binding: 1, resource: { buffer: cellBuffers[i] } },
      ],
    }));
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext, computePipeline, renderPipeline,
      cellBuffers, computeUniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroups, currentBuffer: 0,
    };
  }, []);

  const resetWithPattern = useCallback((pattern: Pattern) => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const data = createPattern(pattern);
    gpu.device.queue.writeBuffer(gpu.cellBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.cellBuffers[1], 0, data);
    gpu.currentBuffer = 0;
    genRef.current = 0;
    setGeneration(0);
  }, []);

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const computeUniforms = new Uint32Array([GRID_W, GRID_H, pausedRef.current ? 1 : 0, 0]);
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, computeUniforms);

    const renderUniforms = new Uint32Array([GRID_W, GRID_H, colorRef.current, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, renderUniforms);

    const encoder = gpu.device.createCommandEncoder();

    // Run multiple steps per frame for speed
    const steps = pausedRef.current ? 0 : speedRef.current;
    for (let s = 0; s < steps; s++) {
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(gpu.computePipeline);
      cpass.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
      cpass.dispatchWorkgroups(Math.ceil(GRID_W / 16), Math.ceil(GRID_H / 16));
      cpass.end();
      gpu.currentBuffer = 1 - gpu.currentBuffer;
      genRef.current++;
    }

    const outIdx = gpu.currentBuffer;
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.03, g: 0.03, b: 0.05, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroups[outIdx]);
    rpass.draw(4);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);

    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
      setGeneration(genRef.current);
      fpsFrames.current = 0;
      fpsTime.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  // Mouse drawing
  const drawCell = useCallback((e: MouseEvent) => {
    const gpu = gpuRef.current;
    const canvas = canvasRef.current;
    if (!gpu || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * GRID_W);
    const y = Math.floor((1 - (e.clientY - rect.top) / rect.height) * GRID_H);
    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) return;
    const idx = y * GRID_W + x;
    const data = new Uint32Array([1]);
    // Write to both buffers
    gpu.device.queue.writeBuffer(gpu.cellBuffers[0], idx * 4, data);
    gpu.device.queue.writeBuffer(gpu.cellBuffers[1], idx * 4, data);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onDown = (e: MouseEvent) => { drawingRef.current = true; drawCell(e); };
    const onMove = (e: MouseEvent) => { if (drawingRef.current) drawCell(e); };
    const onUp = () => { drawingRef.current = false; };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (gpuRef.current) {
        gpuRef.current.cellBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { colorRef.current = colorIdx; }, [colorIdx]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  const handleScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `game-of-life-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  useSimKeyboard({
    onPause: () => setPaused(p => !p),
    onReset: () => resetWithPattern('random'),
    onScreenshot: handleScreenshot,
  });

  const colors = ['Matrix', 'Indigo', 'Amber', 'Cyan'];
  const patterns: { id: Pattern; label: string }[] = [
    { id: 'random', label: 'Random' },
    { id: 'glider-gun', label: 'Glider Gun' },
    { id: 'pulsar', label: 'Pulsar' },
    { id: 'clear', label: 'Clear' },
  ];

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Game of Life</h1>
            <span className="badge">{GRID_W}x{GRID_H}</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
              <span className="divider">|</span>
              <span className="particles">Gen {generation.toLocaleString()}</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Pattern</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {patterns.map(p => (
                <button key={p.id} className="preset-btn" onClick={() => resetWithPattern(p.id)}>
                  <span className="preset-label">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Color Theme</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {colors.map((c, i) => (
                <button key={c} className={`preset-btn ${colorIdx === i ? 'active' : ''}`}
                  onClick={() => setColorIdx(i)}>
                  <span className="preset-label">{c}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Speed <span className="value">{speed} steps/frame</span></label>
            <input type="range" min="1" max="20" step="1" value={speed}
              onChange={e => setSpeed(Number(e.target.value))} />
          </div>
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={() => resetWithPattern('random')}>↻ Random</button>
            <ShareButton canvasRef={canvasRef} title="Game of Life" />
          </div>
          <div className="hints">
            <span>Click/drag to draw cells</span>
            <span>{GRID_W}x{GRID_H} = {(CELL_COUNT/1000).toFixed(0)}k cells computed on GPU</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay
        id="life"
        steps={[
          { icon: '🖱️', title: '클릭', desc: '셀을 클릭해서 살리거나 죽이기' },
          { icon: '🧬', title: 'Conway 법칙', desc: '3개 이웃=탄생, 2-3개=생존' },
          { icon: '🎮', title: '패턴', desc: 'Glider Gun, Pulsar 등 프리셋' },
          { icon: '⌨️', title: '단축키', desc: 'Space=일시정지, R=초기화' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
