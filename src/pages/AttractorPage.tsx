import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import attractorComputeCode from '../shaders/attractor_compute.wgsl?raw';
import attractorRenderCode  from '../shaders/attractor_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const PARTICLE_COUNT = 300_000;
const ATTRACTOR_NAMES = ['Lorenz', 'Thomas', 'Halvorsen', 'Aizawa'];
const COLOR_MODES = ['Speed', 'Animated', 'Position'];

export const AttractorPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    particleBuffers: GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    currentBuffer: number;
  } | null>(null);

  const rafRef    = useRef(0);
  const activeRef = useRef(true);
  const frameRef  = useRef(0);
  const [fps, setFps] = useState(0);
  const fpsFrames = useRef(0);
  const fpsTime   = useRef(performance.now());

  const camRef = useRef({ theta: 0.3, phi: 0.25, dist: 2.5, dragging: false, lastX: 0, lastY: 0 });

  const [attractorType, setAttractorType] = useState(0);
  const [colorMode, setColorMode]         = useState(0);
  const [paused, setPaused]               = useState(false);
  const [autoRotate, setAutoRotate]       = useState(true);

  const attractorRef  = useRef(0);
  const colorModeRef  = useRef(0);
  const pausedRef     = useRef(false);
  const autoRotateRef = useRef(true);

  useEffect(() => { attractorRef.current = attractorType; frameRef.current = 0; }, [attractorType]);
  useEffect(() => { colorModeRef.current = colorMode; },   [colorMode]);
  useEffect(() => { pausedRef.current = paused; },         [paused]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: attractorComputeCode });
    const renderModule  = device.createShaderModule({ code: attractorRenderCode });

    const particleSize = 4 * 4; // 4 floats
    const bufferSize   = PARTICLE_COUNT * particleSize;

    const particleBuffers = [0, 1].map(() => device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const computeUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const renderUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

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
        { binding: 1, resource: { buffer: particleBuffers[i] } },
        { binding: 2, resource: { buffer: particleBuffers[1 - i] } },
      ],
    }));

    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'main' },
    });

    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const renderBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: renderUniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffers[i] } },
      ],
    }));

    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex:   { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule, entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext,
      computePipeline, renderPipeline,
      particleBuffers, computeUniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroups,
      currentBuffer: 0,
    };
  }, []);

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const cam = camRef.current;
    if (autoRotateRef.current && !cam.dragging) {
      cam.theta += 0.004;
    }

    // Compute uniforms: particleCount, attractorType, dt, frame
    const cu = new ArrayBuffer(16);
    const cuU32 = new Uint32Array(cu);
    const cuF32 = new Float32Array(cu);
    cuU32[0] = PARTICLE_COUNT;
    cuU32[1] = attractorRef.current;
    cuF32[2] = 0.005;
    cuU32[3] = frameRef.current;
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Render uniforms: camTheta, camPhi, camDist, time, width, height, attractorType, colorMode
    const canvas = canvasRef.current!;
    const ru = new ArrayBuffer(32);
    const ruF32 = new Float32Array(ru);
    const ruU32 = new Uint32Array(ru);
    ruF32[0] = cam.theta;
    ruF32[1] = cam.phi;
    ruF32[2] = cam.dist;
    ruF32[3] = performance.now() * 0.001;
    ruU32[4] = canvas.width;
    ruU32[5] = canvas.height;
    ruU32[6] = attractorRef.current;
    ruU32[7] = colorModeRef.current;
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const encoder = gpu.device.createCommandEncoder();
    const inIdx   = gpu.currentBuffer;
    const outIdx  = 1 - inIdx;

    if (!pausedRef.current) {
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(gpu.computePipeline);
      cpass.setBindGroup(0, gpu.computeBindGroups[inIdx]);
      cpass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));
      cpass.end();
      gpu.currentBuffer = outIdx;
    }

    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.02, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroups[gpu.currentBuffer]);
    rpass.draw(4, PARTICLE_COUNT);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);
    frameRef.current++;

    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round(fpsFrames.current * 1000 / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current = now;
    }
    rafRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width  = canvas.clientWidth  * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const cam = camRef.current;
    const onDown = (e: MouseEvent) => {
      cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY;
      setAutoRotate(false); autoRotateRef.current = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!cam.dragging) return;
      cam.theta -= (e.clientX - cam.lastX) * 0.005;
      cam.phi    = Math.max(-1.4, Math.min(1.4, cam.phi + (e.clientY - cam.lastY) * 0.005));
      cam.lastX  = e.clientX; cam.lastY = e.clientY;
    };
    const onUp    = () => { cam.dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.dist = Math.max(1.0, Math.min(6.0, cam.dist + e.deltaY * 0.004));
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      cam.dragging = true; cam.lastX = t.clientX; cam.lastY = t.clientY;
      setAutoRotate(false); autoRotateRef.current = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      cam.theta -= (t.clientX - cam.lastX) * 0.005;
      cam.phi    = Math.max(-1.4, Math.min(1.4, cam.phi + (t.clientY - cam.lastY) * 0.005));
      cam.lastX  = t.clientX; cam.lastY  = t.clientY;
    };
    const onTouchEnd = () => { cam.dragging = false; };

    canvas.addEventListener('mousedown',  onDown);
    window.addEventListener('mousemove',  onMove);
    window.addEventListener('mouseup',    onUp);
    canvas.addEventListener('wheel',      onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd);

    initGPU().then(() => {
      rafRef.current = requestAnimationFrame(render);
    });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousedown',  onDown);
      window.removeEventListener('mousemove',  onMove);
      window.removeEventListener('mouseup',    onUp);
      canvas.removeEventListener('wheel',      onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove',  onTouchMove);
      canvas.removeEventListener('touchend',   onTouchEnd);
    };
  }, [initGPU, render]);

  useSimKeyboard({
    onPause: () => { const next = !pausedRef.current; setPaused(next); pausedRef.current = next; },
    onReset: () => { frameRef.current = 0; },
  });

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab' }} />
      </main>

      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Strange Attractors</h1>
            <span className="badge">{(PARTICLE_COUNT / 1000).toFixed(0)}K particles</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Attractor</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {ATTRACTOR_NAMES.map((name, i) => (
                <button
                  key={name}
                  className={`preset-btn${attractorType === i ? ' active' : ''}`}
                  onClick={() => { setAttractorType(i); attractorRef.current = i; frameRef.current = 0; }}
                >
                  <span className="preset-label">{name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {COLOR_MODES.map((m, i) => (
                <button
                  key={m}
                  className={`preset-btn${colorMode === i ? ' active' : ''}`}
                  onClick={() => { setColorMode(i); colorModeRef.current = i; }}
                >
                  <span className="preset-label">{m}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="control-group actions-row">
            <button
              className="action-btn primary"
              onClick={() => { const next = !pausedRef.current; setPaused(next); pausedRef.current = next; }}
            >
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button
              className="action-btn"
              onClick={() => { const next = !autoRotateRef.current; setAutoRotate(next); autoRotateRef.current = next; }}
            >
              {autoRotate ? '🔄 Auto' : '🔄 Off'}
            </button>
            <ShareButton canvasRef={canvasRef} title="Strange Attractor" params={ATTRACTOR_NAMES[attractorType]} />
          </div>

          <div className="hints">
            <span>Drag to orbit · Scroll to zoom</span>
            <span>Space = pause · Switch attractor to reset</span>
          </div>
        </aside>
      </div>

      <TutorialOverlay
        id="attractor"
        steps={[
          { icon: '🌀', title: 'Strange Attractors', desc: '300K particles tracing chaotic dynamical systems in real time on the GPU.' },
          { icon: '🔀', title: 'Switch', desc: 'Lorenz, Thomas, Halvorsen, Aizawa — each has a completely different shape and dynamics.' },
          { icon: '🦋', title: 'Chaos', desc: 'Nearby particles diverge exponentially over time — the butterfly effect visualized.' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
