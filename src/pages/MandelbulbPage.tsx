import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import mandelbulbCode from '../shaders/mandelbulb.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const POWERS = [6, 7, 8, 9, 10];
const COLOR_MODES = ['Rainbow', 'Normals', 'Depth'];

export const MandelbulbPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null>(null);

  const rafRef   = useRef(0);
  const activeRef = useRef(true);
  const [fps, setFps] = useState(0);
  const fpsFrames = useRef(0);
  const fpsTime   = useRef(performance.now());

  const camRef = useRef({ theta: 0.5, phi: 0.3, dist: 2.8, dragging: false, lastX: 0, lastY: 0 });

  const [power, setPower]         = useState(8);
  const [colorMode, setColorMode] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);

  const powerRef      = useRef(8);
  const colorModeRef  = useRef(0);
  const autoRotateRef = useRef(true);

  useEffect(() => { powerRef.current = power; },         [power]);
  useEffect(() => { colorModeRef.current = colorMode; }, [colorMode]);
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const module = device.createShaderModule({ code: mandelbulbCode });

    const uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bgl = device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    const bindGroup = device.createBindGroup({
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex:   { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = { device, canvasContext, pipeline, uniformBuffer, bindGroup };
  }, []);

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const cam = camRef.current;
    if (autoRotateRef.current && !cam.dragging) {
      cam.theta += 0.004;
    }

    const canvas = canvasRef.current!;
    const ub = new ArrayBuffer(32);
    const uU32 = new Uint32Array(ub);
    const uF32 = new Float32Array(ub);
    uU32[0] = canvas.width;
    uU32[1] = canvas.height;
    uF32[2] = performance.now() * 0.001;
    uF32[3] = powerRef.current;
    uF32[4] = cam.theta;
    uF32[5] = cam.phi;
    uF32[6] = cam.dist;
    uU32[7] = colorModeRef.current;
    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, ub);

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.008, g: 0.008, b: 0.015, a: 1 },
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
      cam.dragging = true;
      cam.lastX = e.clientX;
      cam.lastY = e.clientY;
      setAutoRotate(false);
      autoRotateRef.current = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!cam.dragging) return;
      cam.theta -= (e.clientX - cam.lastX) * 0.005;
      cam.phi    = Math.max(-1.4, Math.min(1.4, cam.phi + (e.clientY - cam.lastY) * 0.005));
      cam.lastX  = e.clientX;
      cam.lastY  = e.clientY;
    };
    const onUp   = () => { cam.dragging = false; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.dist = Math.max(1.3, Math.min(5.5, cam.dist + e.deltaY * 0.004));
    };

    // Touch support
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
    onPause: () => {
      const next = !autoRotateRef.current;
      setAutoRotate(next);
      autoRotateRef.current = next;
    },
    onReset: () => {
      const cam = camRef.current;
      cam.theta = 0.5; cam.phi = 0.3; cam.dist = 2.8;
      setAutoRotate(true); autoRotateRef.current = true;
    },
  });

  return (
    <div className="sim-page">
      <canvas ref={canvasRef} className="sim-canvas" />

      <div className="sim-hud">
        <button className="back-btn" onClick={() => navigate('/')}>← Home</button>
        <div className="sim-info">
          <h2>Mandelbulb 3D</h2>
          <p className="fps-counter">{fps} FPS</p>
        </div>
      </div>

      <div className="sim-controls">
        <div className="control-group">
          <label>Power</label>
          <div className="btn-row">
            {POWERS.map(p => (
              <button
                key={p}
                className={`preset-btn${power === p ? ' active' : ''}`}
                onClick={() => { setPower(p); powerRef.current = p; }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label>Color</label>
          <div className="btn-row">
            {COLOR_MODES.map((m, i) => (
              <button
                key={m}
                className={`preset-btn${colorMode === i ? ' active' : ''}`}
                onClick={() => { setColorMode(i); colorModeRef.current = i; }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <button
          className={`action-btn${autoRotate ? ' active' : ''}`}
          onClick={() => {
            const next = !autoRotateRef.current;
            setAutoRotate(next);
            autoRotateRef.current = next;
          }}
        >
          {autoRotate ? '⏸ Pause' : '▶ Rotate'}
        </button>

        <ShareButton canvasRef={canvasRef} title="Mandelbulb 3D" params={`power=${power}`} />
      </div>

      <div className="sim-hints">Drag to orbit · Scroll to zoom · Space to toggle rotation</div>

      <TutorialOverlay
        id="mandelbulb"
        steps={[
          { icon: '🔷', title: 'Mandelbulb 3D', desc: 'A 3D fractal rendered in real-time using GPU ray marching.' },
          { icon: '🖱️', title: 'Orbit', desc: 'Drag to rotate the camera around the fractal. Scroll to zoom.' },
          { icon: '⚡', title: 'Power', desc: 'Change the power to transform the fractal shape entirely. Try 9 or 10 for spiky forms.' },
          { icon: '🎨', title: 'Color', desc: 'Switch color modes to see the fractal from different mathematical perspectives.' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
