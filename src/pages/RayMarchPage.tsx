import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import raymarchCode from '../shaders/raymarch.wgsl?raw';

type SceneId = 0 | 1 | 2 | 3;
const SCENES: { id: SceneId; label: string }[] = [
  { id: 0, label: 'Metaballs' },
  { id: 1, label: 'Menger Sponge' },
  { id: 2, label: 'Linked Tori' },
  { id: 3, label: 'Terrain' },
];

export const RayMarchPage: React.FC = () => {
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
    angleX: 0.5, angleY: 0.3, zoom: 1.0,
    sceneId: 0, fogDensity: 0.08, time: 0,
  });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const [scene, setScene] = useState<SceneId>(0);
  const [fog, setFog] = useState(0.08);
  const [zoom, setZoom] = useState(1.0);
  const [fps, setFps] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const module = device.createShaderModule({ code: raymarchCode });
    const uniformBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const bgl = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
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

    if (autoRotate && !dragRef.current.dragging) {
      s.angleX += 0.003;
    }

    const uniforms = new Float32Array([
      s.time, canvas.width / canvas.height,
      s.angleX, s.angleY, s.zoom,
      s.sceneId, s.fogDensity, 0,
    ]);
    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, uniforms);

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
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
      fpsFrames.current = 0; fpsTime.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, [autoRotate]);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    const onDown = (e: MouseEvent) => { dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY }; };
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      stateRef.current.angleX += (e.clientX - dragRef.current.lastX) * 0.005;
      stateRef.current.angleY += (e.clientY - dragRef.current.lastY) * 0.005;
      stateRef.current.angleY = Math.max(-1.5, Math.min(1.5, stateRef.current.angleY));
      dragRef.current.lastX = e.clientX; dragRef.current.lastY = e.clientY;
    };
    const onUp = () => { dragRef.current.dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stateRef.current.zoom *= e.deltaY > 0 ? 0.95 : 1.05;
      stateRef.current.zoom = Math.max(0.3, Math.min(5, stateRef.current.zoom));
      setZoom(stateRef.current.zoom);
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false; cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (gpuRef.current) {
        gpuRef.current.uniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  useEffect(() => { stateRef.current.sceneId = scene; }, [scene]);
  useEffect(() => { stateRef.current.fogDensity = fog; }, [fog]);

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Ray Marching</h1>
            <span className="badge">3D GPU</span>
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
            <label>Scene</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {SCENES.map(s => (
                <button key={s.id} className={`preset-btn ${scene === s.id ? 'active' : ''}`}
                  onClick={() => setScene(s.id)}>
                  <span className="preset-label">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Fog Density <span className="value">{fog.toFixed(2)}</span></label>
            <input type="range" min="0" max="0.3" step="0.005" value={fog}
              onChange={e => setFog(Number(e.target.value))} />
          </div>
          <div className="control-group actions-row">
            <button className={`action-btn ${autoRotate ? 'primary' : ''}`}
              onClick={() => setAutoRotate(!autoRotate)}>
              {autoRotate ? '↻ Auto' : '↻ Manual'}
            </button>
            <button className="action-btn" onClick={() => {
              const c = canvasRef.current;
              if (!c) return;
              const a = document.createElement('a');
              a.download = `raymarch-${Date.now()}.png`;
              a.href = c.toDataURL('image/png'); a.click();
            }}>📷</button>
          </div>
          <div className="hints">
            <span>Drag: rotate camera · Scroll: zoom</span>
            <span>128 ray steps per pixel · SDF rendering</span>
          </div>
        </aside>
      </div>
    </div>
  );
};
