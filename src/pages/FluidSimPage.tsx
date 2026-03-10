import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import fluidComputeCode from '../shaders/fluid_compute.wgsl?raw';
import fluidRenderCode from '../shaders/fluid_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const GRID_W = 512;
const GRID_H = 512;
const CELL_COUNT = GRID_W * GRID_H;

const DISPLAY_MODES = ['Dye', 'Velocity', 'Pressure', 'Vorticity'];

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    case 5: return [v, p, q];
    default: return [v, t, p];
  }
}

export const FluidSimPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    addForcesPipeline: GPUComputePipeline;
    advectVelocityPipeline: GPUComputePipeline;
    advectDyePipeline: GPUComputePipeline;
    divergencePipeline: GPUComputePipeline;
    pressurePipeline: GPUComputePipeline;
    gradientPipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    velocityBuffers: GPUBuffer[];
    pressureBuffers: GPUBuffer[];
    divergenceBuffer: GPUBuffer;
    dyeBuffers: GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    velIdx: number;
    presIdx: number;
    dyeIdx: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [displayMode, setDisplayMode] = useState(0);
  const [viscosity, setViscosity] = useState(0.0001);
  const [velocityDissipation, setVelocityDissipation] = useState(0.98);
  const [densityDissipation, setDensityDissipation] = useState(0.99);
  const [splatRadius, setSplatRadius] = useState(30);
  const [pressureIterations, setPressureIterations] = useState(30);

  const pausedRef = useRef(false);
  const displayModeRef = useRef(0);
  const viscosityRef = useRef(0.0001);
  const velDissRef = useRef(0.98);
  const densDissRef = useRef(0.99);
  const splatRadiusRef = useRef(30);
  const pressureItersRef = useRef(30);
  const frameRef = useRef(0);
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const mouseRef = useRef({
    x: 0, y: 0,
    prevX: 0, prevY: 0,
    dx: 0, dy: 0,
    active: false,
  });

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: fluidComputeCode });
    const renderModule = device.createShaderModule({ code: fluidRenderCode });

    // Create buffers
    const velocityBuffers = [0, 1].map(() => device.createBuffer({
      size: CELL_COUNT * 2 * 4, // vec2 per cell
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    const pressureBuffers = [0, 1].map(() => device.createBuffer({
      size: CELL_COUNT * 4, // 1 float per cell
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    const divergenceBuffer = device.createBuffer({
      size: CELL_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const dyeBuffers = [0, 1].map(() => device.createBuffer({
      size: CELL_COUNT * 4 * 4, // vec4 per cell
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    // Zero-init all buffers
    const zeroVel = new Float32Array(CELL_COUNT * 2);
    const zeroPres = new Float32Array(CELL_COUNT);
    const zeroDye = new Float32Array(CELL_COUNT * 4);
    velocityBuffers.forEach(b => device.queue.writeBuffer(b, 0, zeroVel));
    pressureBuffers.forEach(b => device.queue.writeBuffer(b, 0, zeroPres));
    device.queue.writeBuffer(divergenceBuffer, 0, zeroPres);
    dyeBuffers.forEach(b => device.queue.writeBuffer(b, 0, zeroDye));

    // Compute uniform: 16 floats = 64 bytes
    const computeUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Render uniform: 4 floats = 16 bytes
    const renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute bind group layout (shared by all compute entry points)
    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeBGL] });

    // Create 2 compute bind groups swapping vel, pressure, dye
    const computeBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: computeUniformBuffer } },
        { binding: 1, resource: { buffer: velocityBuffers[i] } },
        { binding: 2, resource: { buffer: velocityBuffers[1 - i] } },
        { binding: 3, resource: { buffer: pressureBuffers[i] } },
        { binding: 4, resource: { buffer: pressureBuffers[1 - i] } },
        { binding: 5, resource: { buffer: divergenceBuffer } },
        { binding: 6, resource: { buffer: dyeBuffers[i] } },
        { binding: 7, resource: { buffer: dyeBuffers[1 - i] } },
      ],
    }));

    // Create all compute pipelines
    const makeComputePipeline = (entryPoint: string) => device.createComputePipeline({
      layout: computePipelineLayout,
      compute: { module: computeModule, entryPoint },
    });

    const addForcesPipeline = makeComputePipeline('addForces');
    const advectVelocityPipeline = makeComputePipeline('advectVelocity');
    const advectDyePipeline = makeComputePipeline('advectDye');
    const divergencePipeline = makeComputePipeline('computeDivergence');
    const pressurePipeline = makeComputePipeline('pressureSolve');
    const gradientPipeline = makeComputePipeline('subtractGradient');

    // Render bind group layout
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
        { binding: 1, resource: { buffer: dyeBuffers[i] } },
      ],
    }));
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext,
      addForcesPipeline, advectVelocityPipeline, advectDyePipeline,
      divergencePipeline, pressurePipeline, gradientPipeline,
      renderPipeline,
      velocityBuffers, pressureBuffers, divergenceBuffer, dyeBuffers,
      computeUniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroups,
      velIdx: 0, presIdx: 0, dyeIdx: 0,
    };
  }, []);

  const clearBuffers = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const zeroVel = new Float32Array(CELL_COUNT * 2);
    const zeroPres = new Float32Array(CELL_COUNT);
    const zeroDye = new Float32Array(CELL_COUNT * 4);
    gpu.velocityBuffers.forEach(b => gpu.device.queue.writeBuffer(b, 0, zeroVel));
    gpu.pressureBuffers.forEach(b => gpu.device.queue.writeBuffer(b, 0, zeroPres));
    gpu.device.queue.writeBuffer(gpu.divergenceBuffer, 0, zeroPres);
    gpu.dyeBuffers.forEach(b => gpu.device.queue.writeBuffer(b, 0, zeroDye));
    gpu.velIdx = 0;
    gpu.presIdx = 0;
    gpu.dyeIdx = 0;
  }, []);

  const takeScreenshot = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement('a');
    a.download = `fluid-sim-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }, []);

  useSimKeyboard({
    onPause: () => setPaused(p => !p),
    onReset: clearBuffers,
    onScreenshot: takeScreenshot,
  });

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const m = mouseRef.current;
    const dt = 1.0 / 60.0;

    // Compute dye color from time
    const hue = (performance.now() * 0.001) % 1;
    const [dyeR, dyeG, dyeB] = hsvToRgb(hue, 1.0, 1.0);

    // Write compute uniforms
    const cu = new Float32Array(16);
    const cuU32 = new Uint32Array(cu.buffer);
    cuU32[0] = GRID_W;            // gridW
    cuU32[1] = GRID_H;            // gridH
    cu[2] = dt;                    // dt
    cu[3] = viscosityRef.current;  // viscosity
    cu[4] = m.x;                   // mouseX
    cu[5] = m.y;                   // mouseY
    cu[6] = m.dx;                  // mouseDX
    cu[7] = m.dy;                  // mouseDY
    cu[8] = m.active ? 1.0 : 0.0; // mouseActive
    cu[9] = dyeR;                  // dyeR
    cu[10] = dyeG;                 // dyeG
    cu[11] = dyeB;                 // dyeB
    cu[12] = splatRadiusRef.current; // splatRadius
    cuU32[13] = frameRef.current;  // frame
    cu[14] = velDissRef.current;   // velocityDissipation
    cu[15] = densDissRef.current;  // densityDissipation
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Write render uniforms
    const ru = new Uint32Array(4);
    ru[0] = GRID_W;
    ru[1] = GRID_H;
    ru[2] = displayModeRef.current;
    ru[3] = 0;
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const wgX = Math.ceil(GRID_W / 16);
    const wgY = Math.ceil(GRID_H / 16);

    const encoder = gpu.device.createCommandEncoder();

    if (!pausedRef.current) {
      // We need to determine which bind group to use based on current indices.
      // bind group 0: vel[0]->vel[1], pres[0]->pres[1], dye[0]->dye[1]
      // bind group 1: vel[1]->vel[0], pres[1]->pres[0], dye[1]->dye[0]

      // 1. Add forces - writes to velocity[write] and dye[write] via current bind group
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.addForcesPipeline);
        pass.setBindGroup(0, gpu.computeBindGroups[gpu.velIdx]);
        pass.dispatchWorkgroups(wgX, wgY);
        pass.end();
      }

      // 2. Advect velocity - reads vel[read], writes vel[write], then swap
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.advectVelocityPipeline);
        pass.setBindGroup(0, gpu.computeBindGroups[gpu.velIdx]);
        pass.dispatchWorkgroups(wgX, wgY);
        pass.end();
        gpu.velIdx = 1 - gpu.velIdx;
      }

      // 3. Compute divergence
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.divergencePipeline);
        pass.setBindGroup(0, gpu.computeBindGroups[gpu.velIdx]);
        pass.dispatchWorkgroups(wgX, wgY);
        pass.end();
      }

      // 4. Pressure solve - 30 Jacobi iterations
      for (let i = 0; i < pressureItersRef.current; i++) {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.pressurePipeline);
        pass.setBindGroup(0, gpu.computeBindGroups[gpu.presIdx]);
        pass.dispatchWorkgroups(wgX, wgY);
        pass.end();
        gpu.presIdx = 1 - gpu.presIdx;
      }

      // 5. Subtract gradient
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.gradientPipeline);
        pass.setBindGroup(0, gpu.computeBindGroups[gpu.velIdx]);
        pass.dispatchWorkgroups(wgX, wgY);
        pass.end();
      }

      // 6. Advect dye - reads dye[read], writes dye[write], swap
      {
        const pass = encoder.beginComputePass();
        pass.setPipeline(gpu.advectDyePipeline);
        pass.setBindGroup(0, gpu.computeBindGroups[gpu.dyeIdx]);
        pass.dispatchWorkgroups(wgX, wgY);
        pass.end();
        gpu.dyeIdx = 1 - gpu.dyeIdx;
      }
    }

    // Render using current dye buffer
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroups[gpu.dyeIdx]);
    rpass.draw(4);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);

    // Reset mouse delta after each frame
    m.dx = 0;
    m.dy = 0;

    frameRef.current++;

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
    const resize = () => { canvas.width = canvas.clientWidth * dpr; canvas.height = canvas.clientHeight * dpr; };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const getMousePos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / rect.width,
        y: 1 - (clientY - rect.top) / rect.height,
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      const pos = getMousePos(e.clientX, e.clientY);
      const m = mouseRef.current;
      m.x = pos.x;
      m.y = pos.y;
      m.prevX = pos.x;
      m.prevY = pos.y;
      m.dx = 0;
      m.dy = 0;
      m.active = true;
    };

    const onMouseMove = (e: MouseEvent) => {
      const m = mouseRef.current;
      const pos = getMousePos(e.clientX, e.clientY);
      if (m.active) {
        m.dx = (pos.x - m.prevX) * GRID_W;
        m.dy = (pos.y - m.prevY) * GRID_H;
      }
      m.prevX = m.x;
      m.prevY = m.y;
      m.x = pos.x;
      m.y = pos.y;
    };

    const onMouseUp = () => {
      mouseRef.current.active = false;
      mouseRef.current.dx = 0;
      mouseRef.current.dy = 0;
    };

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      const pos = getMousePos(t.clientX, t.clientY);
      const m = mouseRef.current;
      m.x = pos.x;
      m.y = pos.y;
      m.prevX = pos.x;
      m.prevY = pos.y;
      m.dx = 0;
      m.dy = 0;
      m.active = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      const m = mouseRef.current;
      const pos = getMousePos(t.clientX, t.clientY);
      m.dx = (pos.x - m.prevX) * GRID_W;
      m.dy = (pos.y - m.prevY) * GRID_H;
      m.prevX = m.x;
      m.prevY = m.y;
      m.x = pos.x;
      m.y = pos.y;
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      mouseRef.current.active = false;
      mouseRef.current.dx = 0;
      mouseRef.current.dy = 0;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      if (gpuRef.current) {
        gpuRef.current.velocityBuffers.forEach(b => b.destroy());
        gpuRef.current.pressureBuffers.forEach(b => b.destroy());
        gpuRef.current.divergenceBuffer.destroy();
        gpuRef.current.dyeBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);
  useEffect(() => { viscosityRef.current = viscosity; }, [viscosity]);
  useEffect(() => { velDissRef.current = velocityDissipation; }, [velocityDissipation]);
  useEffect(() => { densDissRef.current = densityDissipation; }, [densityDissipation]);
  useEffect(() => { splatRadiusRef.current = splatRadius; }, [splatRadius]);
  useEffect(() => { pressureItersRef.current = pressureIterations; }, [pressureIterations]);

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Fluid Sim</h1>
            <span className="badge">{GRID_W}x{GRID_H}</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Display</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {DISPLAY_MODES.map((mode, i) => (
                <button key={mode} className={`preset-btn ${displayMode === i ? 'active' : ''}`}
                  onClick={() => setDisplayMode(i)}>
                  <span className="preset-label">{mode}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Viscosity <span className="value">{viscosity.toFixed(4)}</span></label>
            <input type="range" min="0" max="0.001" step="0.00001" value={viscosity}
              onChange={e => setViscosity(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Velocity Dissipation <span className="value">{velocityDissipation.toFixed(2)}</span></label>
            <input type="range" min="0.95" max="1.0" step="0.001" value={velocityDissipation}
              onChange={e => setVelocityDissipation(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Density Dissipation <span className="value">{densityDissipation.toFixed(2)}</span></label>
            <input type="range" min="0.95" max="1.0" step="0.001" value={densityDissipation}
              onChange={e => setDensityDissipation(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Splat Radius <span className="value">{splatRadius}</span></label>
            <input type="range" min="10" max="100" step="1" value={splatRadius}
              onChange={e => setSplatRadius(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Pressure Iterations <span className="value">{pressureIterations}</span></label>
            <input type="range" min="10" max="60" step="1" value={pressureIterations}
              onChange={e => setPressureIterations(Number(e.target.value))} />
          </div>
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={clearBuffers}>↻ Clear</button>
            <button className="action-btn" onClick={takeScreenshot}>📷</button>
            <ShareButton canvasRef={canvasRef} title="Fluid Sim" />
          </div>
          <div className="hints">
            <span>Click/drag to inject dye and force</span>
            <span>Navier-Stokes · Stable Fluids · {GRID_W}x{GRID_H}</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay
        id="fluid"
        steps={[
          { icon: '🖱️', title: '드래그', desc: '마우스 드래그로 유체에 힘과 염료 주입' },
          { icon: '🌈', title: '자동 색상', desc: '시간에 따라 염료 색상이 자동 변경' },
          { icon: '👁️', title: '디스플레이', desc: '염료/속도/압력/와도 시각화 전환' },
          { icon: '⚙️', title: '물리', desc: '점성도, 확산, 압력 반복 횟수 조절' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
