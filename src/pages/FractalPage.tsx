import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import fractalShaderCode from '../shaders/fractal.wgsl?raw';

type FractalMode = 'mandelbrot' | 'julia';
type ColorMode = 'classic' | 'fire' | 'ocean' | 'neon';
const COLOR_MODES: { id: ColorMode; idx: number; label: string }[] = [
  { id: 'classic', idx: 0, label: 'Rainbow' },
  { id: 'fire', idx: 1, label: 'Fire' },
  { id: 'ocean', idx: 2, label: 'Ocean' },
  { id: 'neon', idx: 3, label: 'Neon' },
];

export const FractalPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const stateRef = useRef({
    centerX: -0.5,
    centerY: 0.0,
    zoom: 1.0,
    maxIter: 200,
    juliaReal: -0.7,
    juliaImag: 0.27015,
    isJulia: false,
    colorMode: 0,
    time: 0,
  });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });

  const [fractalMode, setFractalMode] = useState<FractalMode>('mandelbrot');
  const [colorMode, setColorMode] = useState<ColorMode>('classic');
  const [zoom, setZoom] = useState(1.0);
  const [maxIter, setMaxIter] = useState(200);
  const [juliaR, setJuliaR] = useState(-0.7);
  const [juliaI, setJuliaI] = useState(0.27015);
  const [fps, setFps] = useState(0);
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const shaderModule = device.createShaderModule({ code: fractalShaderCode });
    const uniformBuffer = device.createBuffer({
      size: 48, // 12 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bgl = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule, entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = { device, canvasContext, pipeline, uniformBuffer, bindGroup };
  }, []);

  const render = useCallback((time: number) => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const canvas = canvasRef.current!;
    const s = stateRef.current;
    s.time = time / 1000;

    const uniforms = new Float32Array([
      s.centerX, s.centerY, s.zoom, s.maxIter,
      s.juliaReal, s.juliaImag, s.isJulia ? 1.0 : 0.0, s.time,
      canvas.width / canvas.height, s.colorMode, 0, 0,
    ]);
    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, uniforms);

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    pass.setPipeline(gpu.pipeline);
    pass.setBindGroup(0, gpu.bindGroup);
    pass.draw(4);
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);

    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  // Mouse handlers for pan/zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const s = stateRef.current;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    s.zoom *= factor;
    setZoom(s.zoom);
    // Auto increase iterations at deep zoom
    if (s.zoom > 100 && s.maxIter < 500) {
      s.maxIter = Math.min(500, Math.floor(200 + Math.log2(s.zoom) * 30));
      setMaxIter(s.maxIter);
    }
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current.dragging) return;
    const canvas = canvasRef.current!;
    const s = stateRef.current;
    const dx = (e.clientX - dragRef.current.lastX) / canvas.clientWidth;
    const dy = (e.clientY - dragRef.current.lastY) / canvas.clientHeight;
    const scale = 2.0 / s.zoom;
    s.centerX -= dx * scale * (canvas.width / canvas.height);
    s.centerY += dy * scale;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (gpuRef.current) {
        gpuRef.current.uniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  // Sync state from React
  useEffect(() => {
    stateRef.current.isJulia = fractalMode === 'julia';
    stateRef.current.colorMode = COLOR_MODES.find(c => c.id === colorMode)?.idx ?? 0;
    stateRef.current.maxIter = maxIter;
    stateRef.current.juliaReal = juliaR;
    stateRef.current.juliaImag = juliaI;
  }, [fractalMode, colorMode, maxIter, juliaR, juliaI]);

  const presets = [
    { label: 'Seahorse Valley', cx: -0.745, cy: 0.186, z: 200 },
    { label: 'Elephant Valley', cx: 0.281717, cy: 0.5771, z: 500 },
    { label: 'Spiral', cx: -0.7463, cy: 0.1102, z: 1000 },
    { label: 'Mini Mandelbrot', cx: -1.768778, cy: -0.001738, z: 5000 },
  ];

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }} />
      </main>

      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Fractal Explorer</h1>
            <span className="badge">{fractalMode}</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
              <span className="divider">|</span>
              <span className="particles">x{zoom.toFixed(1)}</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Mode</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <button className={`preset-btn ${fractalMode === 'mandelbrot' ? 'active' : ''}`}
                onClick={() => { setFractalMode('mandelbrot'); stateRef.current.centerX = -0.5; stateRef.current.centerY = 0; stateRef.current.zoom = 1; setZoom(1); }}>
                <span className="preset-label">Mandelbrot</span>
              </button>
              <button className={`preset-btn ${fractalMode === 'julia' ? 'active' : ''}`}
                onClick={() => setFractalMode('julia')}>
                <span className="preset-label">Julia Set</span>
              </button>
            </div>
          </div>

          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {COLOR_MODES.map(c => (
                <button key={c.id} className={`preset-btn ${colorMode === c.id ? 'active' : ''}`}
                  onClick={() => setColorMode(c.id)}>
                  <span className="preset-label">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Max Iterations <span className="value">{maxIter}</span></label>
            <input type="range" min="50" max="1000" step="10" value={maxIter}
              onChange={e => setMaxIter(Number(e.target.value))} />
          </div>

          {fractalMode === 'julia' && (
            <>
              <div className="control-group">
                <label>Julia Real <span className="value">{juliaR.toFixed(4)}</span></label>
                <input type="range" min="-2" max="2" step="0.001" value={juliaR}
                  onChange={e => setJuliaR(Number(e.target.value))} />
              </div>
              <div className="control-group">
                <label>Julia Imaginary <span className="value">{juliaI.toFixed(4)}</span></label>
                <input type="range" min="-2" max="2" step="0.001" value={juliaI}
                  onChange={e => setJuliaI(Number(e.target.value))} />
              </div>
            </>
          )}

          {fractalMode === 'mandelbrot' && (
            <div className="control-group">
              <label>Presets</label>
              <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {presets.map(p => (
                  <button key={p.label} className="preset-btn" onClick={() => {
                    stateRef.current.centerX = p.cx;
                    stateRef.current.centerY = p.cy;
                    stateRef.current.zoom = p.z;
                    stateRef.current.maxIter = Math.min(800, 200 + Math.floor(Math.log2(p.z) * 30));
                    setZoom(p.z);
                    setMaxIter(stateRef.current.maxIter);
                  }}>
                    <span className="preset-label">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => {
              stateRef.current.centerX = fractalMode === 'mandelbrot' ? -0.5 : 0;
              stateRef.current.centerY = 0;
              stateRef.current.zoom = 1;
              setZoom(1);
              setMaxIter(200);
            }}>↻ Reset</button>
            <button className="action-btn" onClick={() => {
              const canvas = canvasRef.current;
              if (!canvas) return;
              const link = document.createElement('a');
              link.download = `fractal-${Date.now()}.png`;
              link.href = canvas.toDataURL('image/png');
              link.click();
            }}>📷</button>
          </div>

          <div className="hints">
            <span>Scroll: zoom · Drag: pan</span>
            <span>Deep zoom auto-increases iterations</span>
          </div>
        </aside>
      </div>
    </div>
  );
};
