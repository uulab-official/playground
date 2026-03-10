import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import galaxyComputeCode from '../shaders/galaxy_compute.wgsl?raw';
import galaxyRenderCode from '../shaders/galaxy_render.wgsl?raw';

const MAX_BODIES = 20000;
const BODY_FLOATS = 8; // x, y, vx, vy, mass, brightness, temperature, age

type Preset = 'spiral' | 'collision' | 'ring' | 'random';

function gaussRandom(): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

function createGalaxy(count: number, preset: Preset): Float32Array<ArrayBuffer> {
  const data = new Float32Array(count * BODY_FLOATS);

  for (let i = 0; i < count; i++) {
    const idx = i * BODY_FLOATS;
    let x = 0, y = 0, vx = 0, vy = 0;
    let mass = 0.5 + Math.random() * 1.0;
    let temperature = 3000 + Math.random() * 7000;

    if (preset === 'spiral') {
      // Two spiral arms
      const arm = i % 2;
      const armAngle = arm * Math.PI;
      const t = Math.random();
      const r = 0.05 + t * 0.8;
      const windAngle = armAngle + t * 4.0 * Math.PI; // spiral winding
      const spread = 0.03 + t * 0.08;

      x = r * Math.cos(windAngle) + gaussRandom() * spread;
      y = r * Math.sin(windAngle) + gaussRandom() * spread;

      // Orbital velocity (roughly circular)
      const orbitalSpeed = Math.sqrt(0.5 / (r + 0.1)) * 0.3;
      vx = -Math.sin(windAngle) * orbitalSpeed + gaussRandom() * 0.01;
      vy = Math.cos(windAngle) * orbitalSpeed + gaussRandom() * 0.01;

      // Inner stars hotter
      temperature = 2000 + (1.0 - t) * 15000 + Math.random() * 3000;
      mass = 0.3 + Math.random() * (1.0 - t * 0.5);
    } else if (preset === 'collision') {
      // Two clusters heading toward each other
      const cluster = i < count / 2 ? 0 : 1;
      const cx = cluster === 0 ? -0.4 : 0.4;
      const cy = cluster === 0 ? -0.1 : 0.1;
      const r = Math.random() * 0.25;
      const angle = Math.random() * Math.PI * 2;

      x = cx + Math.cos(angle) * r + gaussRandom() * 0.02;
      y = cy + Math.sin(angle) * r + gaussRandom() * 0.02;

      // Heading toward the other cluster
      const heading = cluster === 0 ? 1 : -1;
      const orbitalSpeed = Math.sqrt(0.3 / (r + 0.1)) * 0.15;
      vx = heading * 0.15 - Math.sin(angle) * orbitalSpeed;
      vy = -heading * 0.05 + Math.cos(angle) * orbitalSpeed;

      temperature = 4000 + Math.random() * 10000;
    } else if (preset === 'ring') {
      // Bodies in a ring with orbital velocities
      const baseR = 0.3 + Math.random() * 0.15;
      const angle = Math.random() * Math.PI * 2;
      const spread = gaussRandom() * 0.03;

      x = (baseR + spread) * Math.cos(angle);
      y = (baseR + spread) * Math.sin(angle);

      // Orbital velocity
      const orbitalSpeed = Math.sqrt(0.8 / baseR) * 0.2;
      vx = -Math.sin(angle) * orbitalSpeed;
      vy = Math.cos(angle) * orbitalSpeed;

      // Add a central mass cluster (first 5% of bodies)
      if (i < count * 0.05) {
        const cr = Math.random() * 0.03;
        const ca = Math.random() * Math.PI * 2;
        x = cr * Math.cos(ca);
        y = cr * Math.sin(ca);
        vx = gaussRandom() * 0.01;
        vy = gaussRandom() * 0.01;
        mass = 1.0 + Math.random() * 1.5;
        temperature = 15000 + Math.random() * 20000;
      } else {
        temperature = 3000 + Math.random() * 5000;
      }
    } else {
      // Random with slight rotation
      const r = Math.random() * 0.8;
      const angle = Math.random() * Math.PI * 2;
      x = r * Math.cos(angle) + gaussRandom() * 0.05;
      y = r * Math.sin(angle) + gaussRandom() * 0.05;

      // Slight overall rotation
      const orbitalSpeed = 0.05 * r;
      vx = -Math.sin(angle) * orbitalSpeed + gaussRandom() * 0.02;
      vy = Math.cos(angle) * orbitalSpeed + gaussRandom() * 0.02;

      temperature = 2000 + Math.random() * 15000;
    }

    const brightness = 0.4 + Math.random() * 0.6;

    data[idx + 0] = x;
    data[idx + 1] = y;
    data[idx + 2] = vx;
    data[idx + 3] = vy;
    data[idx + 4] = mass;
    data[idx + 5] = brightness;
    data[idx + 6] = temperature;
    data[idx + 7] = 0; // age
  }

  return data;
}

export const GalaxyPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    bodyBuffers: GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    currentBuffer: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const lastTimeRef = useRef(0);
  const timeAccRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, leftPressed: false, rightPressed: false });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const [bodyCount, setBodyCount] = useState(10000);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [preset, setPreset] = useState<Preset>('spiral');
  const [gravity, setGravity] = useState(1.0);
  const [softening, setSoftening] = useState(0.1);
  const [damping, setDamping] = useState(0.999);
  const [starSize, setStarSize] = useState(1.0);
  const [colorMode, setColorMode] = useState(0);

  const paramsRef = useRef({
    bodyCount: 10000, paused: false, preset: 'spiral' as Preset,
    gravity: 1.0, softening: 0.1, damping: 0.999,
    starSize: 1.0, colorMode: 0,
  });

  useEffect(() => {
    paramsRef.current = {
      bodyCount, paused, preset,
      gravity, softening, damping,
      starSize, colorMode,
    };
  }, [bodyCount, paused, preset, gravity, softening, damping, starSize, colorMode]);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: galaxyComputeCode });
    const renderModule = device.createShaderModule({ code: galaxyRenderCode });

    const bodyByteSize = MAX_BODIES * BODY_FLOATS * 4;
    const bodyBuffers = [0, 1].map(() => device.createBuffer({
      size: bodyByteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const initialData = createGalaxy(bodyCount, preset);
    device.queue.writeBuffer(bodyBuffers[0], 0, initialData);
    device.queue.writeBuffer(bodyBuffers[1], 0, initialData);

    // Compute uniform: 12 floats padded to 48 bytes (must be multiple of 16 -> 64 bytes)
    const computeUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Render uniform: 4 floats = 16 bytes
    const renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute bind group layout
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
        { binding: 1, resource: { buffer: bodyBuffers[i] } },
        { binding: 2, resource: { buffer: bodyBuffers[1 - i] } },
      ],
    }));
    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    // Render bind group layout - uses storage buffer for body data
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
        { binding: 1, resource: { buffer: bodyBuffers[i] } },
      ],
    }));
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: {
        module: renderModule,
        entryPoint: 'vs_main',
        buffers: [],
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext, computePipeline, renderPipeline,
      bodyBuffers, computeUniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroups, currentBuffer: 0,
    };
  }, [bodyCount, preset]);

  const resetSimulation = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const p = paramsRef.current;
    const data = createGalaxy(p.bodyCount, p.preset);
    gpu.device.queue.writeBuffer(gpu.bodyBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.bodyBuffers[1], 0, data);
    gpu.currentBuffer = 0;
    timeAccRef.current = 0;
  }, []);

  const takeScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `galaxy-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const render = useCallback((time: number) => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    let dt = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;
    if (dt > 0.1) dt = 0.016;

    const p = paramsRef.current;
    const m = mouseRef.current;

    if (!p.paused) {
      timeAccRef.current += dt;
    }

    // Compute uniforms (matches Params struct in shader)
    const computeUniforms = new ArrayBuffer(64);
    const u32View = new Uint32Array(computeUniforms);
    const f32View = new Float32Array(computeUniforms);

    u32View[0] = p.bodyCount;                         // bodyCount (u32)
    f32View[1] = p.paused ? 0.0 : Math.min(dt, 0.02); // deltaTime
    f32View[2] = p.gravity;                            // gravity
    f32View[3] = p.softening;                          // softening
    f32View[4] = p.damping;                            // damping
    f32View[5] = m.x;                                  // mouseX
    f32View[6] = m.y;                                  // mouseY
    f32View[7] = m.leftPressed ? 1.0 : (m.rightPressed ? -1.0 : 0.0); // mouseActive
    f32View[8] = timeAccRef.current;                   // time

    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, computeUniforms);

    // Render uniforms (matches RenderParams in render shader)
    const canvas = canvasRef.current!;
    const aspectRatio = canvas.width / canvas.height;
    const renderU = new Float32Array([
      aspectRatio,
      p.starSize,
      timeAccRef.current,
      p.bodyCount,
    ]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, renderU);

    const encoder = gpu.device.createCommandEncoder();

    // Compute pass
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(gpu.computePipeline);
    cpass.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
    cpass.dispatchWorkgroups(Math.ceil(p.bodyCount / 256));
    cpass.end();

    const outIdx = 1 - gpu.currentBuffer;

    // Render pass
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.005, g: 0.005, b: 0.015, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroups[outIdx]);
    rpass.draw(4, p.bodyCount); // 4 vertices (triangle-strip quad), instanced
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);
    gpu.currentBuffer = outIdx;

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
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
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouseRef.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      if (e.button === 0) mouseRef.current.leftPressed = true;
      if (e.button === 2) mouseRef.current.rightPressed = true;
    };
    const onUp = (e: MouseEvent) => {
      if (e.button === 0) mouseRef.current.leftPressed = false;
      if (e.button === 2) mouseRef.current.rightPressed = false;
    };
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mouseup', onUp);

    lastTimeRef.current = performance.now();
    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('mouseup', onUp);
      if (gpuRef.current) {
        gpuRef.current.bodyBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>N-Body Galaxy</h1>
            <span className="badge">{bodyCount.toLocaleString()} bodies</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Preset</label>
            <div className="control-group actions-row">
              {(['spiral', 'collision', 'ring', 'random'] as Preset[]).map(p => (
                <button key={p} className={`action-btn${preset === p ? ' primary' : ''}`}
                  onClick={() => { setPreset(p); }}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Body Count <span className="value">{bodyCount.toLocaleString()}</span></label>
            <input type="range" min="1000" max="20000" step="1000" value={bodyCount}
              onChange={e => setBodyCount(Number(e.target.value))} />
            <div className="range-values"><span>1,000</span><span>20,000</span></div>
          </div>

          <div className="control-group">
            <label>Gravity <span className="value">{gravity.toFixed(1)}</span></label>
            <input type="range" min="0.1" max="10.0" step="0.1" value={gravity}
              onChange={e => setGravity(Number(e.target.value))} />
            <div className="range-values"><span>0.1</span><span>10.0</span></div>
          </div>

          <div className="control-group">
            <label>Softening <span className="value">{softening.toFixed(2)}</span></label>
            <input type="range" min="0.01" max="1.0" step="0.01" value={softening}
              onChange={e => setSoftening(Number(e.target.value))} />
            <div className="range-values"><span>0.01</span><span>1.0</span></div>
          </div>

          <div className="control-group">
            <label>Damping <span className="value">{damping.toFixed(3)}</span></label>
            <input type="range" min="0.99" max="1.0" step="0.001" value={damping}
              onChange={e => setDamping(Number(e.target.value))} />
            <div className="range-values"><span>0.990</span><span>1.000</span></div>
          </div>

          <div className="control-group">
            <label>Star Size <span className="value">{starSize.toFixed(1)}</span></label>
            <input type="range" min="0.2" max="3.0" step="0.1" value={starSize}
              onChange={e => setStarSize(Number(e.target.value))} />
            <div className="range-values"><span>0.2</span><span>3.0</span></div>
          </div>

          <div className="control-group">
            <label>Color Mode</label>
            <div className="control-group actions-row">
              <button className={`action-btn${colorMode === 0 ? ' primary' : ''}`}
                onClick={() => setColorMode(0)}>Temperature</button>
              <button className={`action-btn${colorMode === 1 ? ' primary' : ''}`}
                onClick={() => setColorMode(1)}>Velocity</button>
            </div>
          </div>

          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetSimulation}>↻ Reset</button>
            <button className="action-btn" onClick={takeScreenshot}>📷</button>
          </div>

          <div className="hints">
            <span>Left click: gravitational attractor</span>
            <span>Right click: repulsor</span>
            <span>GPU N-Body with shared memory tiling</span>
          </div>
        </aside>
      </div>
    </div>
  );
};
