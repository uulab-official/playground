import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';
import sandComputeCode from '../shaders/sand_compute.wgsl?raw';
import sandRenderCode from '../shaders/sand_render.wgsl?raw';

const GRID_W = 400;
const GRID_H = 300;
const CELL_COUNT = GRID_W * GRID_H;

type Material = 'sand' | 'water' | 'fire' | 'stone' | 'steam' | 'eraser';
const MATERIALS: { id: Material; code: number; label: string; color: string }[] = [
  { id: 'sand', code: 1, label: 'Sand', color: '#dfc76b' },
  { id: 'water', code: 2, label: 'Water', color: '#2563eb' },
  { id: 'fire', code: 3, label: 'Fire', color: '#f97316' },
  { id: 'stone', code: 4, label: 'Stone', color: '#6b7280' },
  { id: 'steam', code: 5, label: 'Steam', color: '#94a3b8' },
  { id: 'eraser', code: 0, label: 'Eraser', color: '#1f2937' },
];

export const FallingSandPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    gridBuffers: GPUBuffer[];
    computeUB: GPUBuffer;
    renderUB: GPUBuffer;
    computeBGs: GPUBindGroup[];
    renderBGs: GPUBindGroup[];
    currentBuffer: number;
    frame: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const [material, setMaterial] = useState<Material>('sand');
  const [brushSize, setBrushSize] = useState(5);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const pausedRef = useRef(false);
  const materialRef = useRef(1);
  const brushRef = useRef(5);
  const drawingRef = useRef(false);
  const lastDrawRef = useRef({ x: -1, y: -1 });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: sandComputeCode });
    const renderModule = device.createShaderModule({ code: sandRenderCode });

    const bufSize = CELL_COUNT * 4;
    const gridBuffers = [0, 1].map(() => device.createBuffer({
      size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    // Clear to empty
    const empty = new Uint32Array(CELL_COUNT);
    device.queue.writeBuffer(gridBuffers[0], 0, empty);
    device.queue.writeBuffer(gridBuffers[1], 0, empty);

    const computeUB = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderUB = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const cBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const computeBGs = [0, 1].map(i => device.createBindGroup({
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
    const renderBGs = [0, 1].map(i => device.createBindGroup({
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
      gridBuffers, computeUB, renderUB, computeBGs, renderBGs,
      currentBuffer: 0, frame: 0,
    };
  }, []);

  const drawAt = useCallback((cx: number, cy: number) => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const mat = materialRef.current;
    const bs = brushRef.current;
    const cells = new Uint32Array(1);
    cells[0] = mat;

    for (let dy = -bs; dy <= bs; dy++) {
      for (let dx = -bs; dx <= bs; dx++) {
        if (dx * dx + dy * dy > bs * bs) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
        const idx = y * GRID_W + x;
        gpu.device.queue.writeBuffer(gpu.gridBuffers[0], idx * 4, cells);
        gpu.device.queue.writeBuffer(gpu.gridBuffers[1], idx * 4, cells);
      }
    }
  }, []);

  const clearGrid = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const empty = new Uint32Array(CELL_COUNT);
    gpu.device.queue.writeBuffer(gpu.gridBuffers[0], 0, empty);
    gpu.device.queue.writeBuffer(gpu.gridBuffers[1], 0, empty);
  }, []);

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    gpu.frame++;

    const cu = new Uint32Array([GRID_W, GRID_H, gpu.frame, pausedRef.current ? 1 : 0]);
    gpu.device.queue.writeBuffer(gpu.computeUB, 0, cu);
    const ru = new Uint32Array([GRID_W, GRID_H, 0, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUB, 0, ru);

    const encoder = gpu.device.createCommandEncoder();

    if (!pausedRef.current) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(gpu.computePipeline);
      cp.setBindGroup(0, gpu.computeBGs[gpu.currentBuffer]);
      cp.dispatchWorkgroups(Math.ceil(GRID_W / 16), Math.ceil(GRID_H / 16));
      cp.end();
      gpu.currentBuffer = 1 - gpu.currentBuffer;
    }

    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
    });
    rp.setPipeline(gpu.renderPipeline);
    rp.setBindGroup(0, gpu.renderBGs[gpu.currentBuffer]);
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

    const getGridCoords = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * GRID_W);
      const y = Math.floor((1 - (e.clientY - r.top) / r.height) * GRID_H);
      return { x, y };
    };
    const onDown = (e: MouseEvent) => {
      drawingRef.current = true;
      const { x, y } = getGridCoords(e);
      lastDrawRef.current = { x, y };
      drawAt(x, y);
    };
    const onMove = (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const { x, y } = getGridCoords(e);
      // Interpolate between last and current position
      const lx = lastDrawRef.current.x, ly = lastDrawRef.current.y;
      const steps = Math.max(Math.abs(x - lx), Math.abs(y - ly));
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        drawAt(Math.round(lx + (x - lx) * t), Math.round(ly + (y - ly) * t));
      }
      lastDrawRef.current = { x, y };
    };
    const onUp = () => { drawingRef.current = false; };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((touch.clientX - r.left) / r.width * GRID_W);
      const y = Math.floor((1 - (touch.clientY - r.top) / r.height) * GRID_H);
      drawingRef.current = true;
      lastDrawRef.current = { x, y };
      drawAt(x, y);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!drawingRef.current) return;
      const touch = e.touches[0];
      const r = canvas.getBoundingClientRect();
      const x = Math.floor((touch.clientX - r.left) / r.width * GRID_W);
      const y = Math.floor((1 - (touch.clientY - r.top) / r.height) * GRID_H);
      const lx = lastDrawRef.current.x, ly = lastDrawRef.current.y;
      const steps = Math.max(Math.abs(x - lx), Math.abs(y - ly));
      for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 0 : i / steps;
        drawAt(Math.round(lx + (x - lx) * t), Math.round(ly + (y - ly) * t));
      }
      lastDrawRef.current = { x, y };
    };
    const onTouchEnd = () => { drawingRef.current = false; };

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false; cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      if (gpuRef.current) {
        gpuRef.current.gridBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUB.destroy();
        gpuRef.current.renderUB.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  useSimKeyboard({
    onPause: () => setPaused(p => !p),
    onReset: () => { clearGrid(); },
    onScreenshot: () => {
      const c = canvasRef.current;
      if (!c) return;
      const a = document.createElement('a');
      a.download = `sand-${Date.now()}.png`;
      a.href = c.toDataURL('image/png'); a.click();
    },
  });

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => {
    materialRef.current = MATERIALS.find(m => m.id === material)?.code ?? 1;
  }, [material]);
  useEffect(() => { brushRef.current = brushSize; }, [brushSize]);

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Falling Sand</h1>
            <span className="badge">{material}</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
              <span className="divider">|</span>
              <span className="particles">{GRID_W}x{GRID_H}</span>
            </div>
          </div>
        </header>

        {/* Left toolbar for materials */}
        <div className="toolbar-left">
          <div className="toolbar-section">
            <span className="toolbar-title">Material</span>
            {MATERIALS.map(m => (
              <button key={m.id}
                className={`toolbar-btn ${material === m.id ? 'active' : ''}`}
                onClick={() => setMaterial(m.id)}
                style={{ '--mat-color': m.color } as React.CSSProperties}>
                <span className="mat-dot" />
                <span className="toolbar-label">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Brush Size <span className="value">{brushSize}</span></label>
            <input type="range" min="1" max="20" step="1" value={brushSize}
              onChange={e => setBrushSize(Number(e.target.value))} />
          </div>
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={clearGrid}>🗑 Clear</button>
            <button className="action-btn" onClick={() => {
              const c = canvasRef.current;
              if (!c) return;
              const a = document.createElement('a');
              a.download = `sand-${Date.now()}.png`;
              a.href = c.toDataURL('image/png'); a.click();
            }}>📷</button>
            <ShareButton canvasRef={canvasRef} title="Falling Sand" />
          </div>
          <div className="hints">
            <span>Click/drag to place materials</span>
            <span>Fire + Water = Steam</span>
            <span>Sand sinks through Water</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay id="sand" steps={[
        { icon: '🖱️', title: '드래그', desc: '클릭/드래그로 재료 배치' },
        { icon: '🏖️', title: '재료', desc: '모래/물/불/돌/증기 선택' },
        { icon: '🔥', title: '상호작용', desc: '불+물=증기, 모래는 물에 가라앉음' },
        { icon: '⌨️', title: '단축키', desc: 'Space=일시정지, R=화면 초기화' },
      ]} onClose={() => {}} />
    </div>
  );
};
