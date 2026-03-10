import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import boidsComputeCode from '../shaders/boids_compute.wgsl?raw';
import boidsRenderCode from '../shaders/boids_render.wgsl?raw';

const MAX_BOIDS = 5000;

function createBoids(count: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    data[i * 4 + 0] = (Math.random() * 2 - 1) * 0.8;
    data[i * 4 + 1] = (Math.random() * 2 - 1) * 0.8;
    data[i * 4 + 2] = Math.cos(angle) * 0.3;
    data[i * 4 + 3] = Math.sin(angle) * 0.3;
  }
  return data;
}

export const BoidsPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    boidBuffers: GPUBuffer[];
    uniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroup: GPUBindGroup;
    currentBuffer: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const lastTimeRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, pressed: false });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const [boidCount, setBoidCount] = useState(1500);
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [separation, setSeparation] = useState(0.05);
  const [alignment, setAlignment] = useState(0.1);
  const [cohesion, setCohesion] = useState(0.15);
  const [sepForce, setSepForce] = useState(1.5);
  const [aliForce, setAliForce] = useState(1.0);
  const [cohForce, setCohForce] = useState(0.8);
  const [maxSpeed, setMaxSpeed] = useState(0.5);

  const paramsRef = useRef({
    boidCount: 1500, paused: false,
    separation: 0.05, alignment: 0.1, cohesion: 0.15,
    sepForce: 1.5, aliForce: 1.0, cohForce: 0.8, maxSpeed: 0.5,
  });

  useEffect(() => {
    paramsRef.current = {
      boidCount, paused,
      separation, alignment, cohesion,
      sepForce, aliForce, cohForce, maxSpeed,
    };
  }, [boidCount, paused, separation, alignment, cohesion, sepForce, aliForce, cohForce, maxSpeed]);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: boidsComputeCode });
    const renderModule = device.createShaderModule({ code: boidsRenderCode });

    const boidByteSize = MAX_BOIDS * 16;
    const boidBuffers = [0, 1].map(() => device.createBuffer({
      size: boidByteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const initialData = createBoids(boidCount);
    device.queue.writeBuffer(boidBuffers[0], 0, initialData);
    device.queue.writeBuffer(boidBuffers[1], 0, initialData);

    const uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderUniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: boidBuffers[i] } },
        { binding: 2, resource: { buffer: boidBuffers[1 - i] } },
      ],
    }));
    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    const renderBGL = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const renderBindGroup = device.createBindGroup({
      layout: renderBGL,
      entries: [{ binding: 0, resource: { buffer: renderUniformBuffer } }],
    });
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: {
        module: renderModule, entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 16, stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: renderModule, entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });

    gpuRef.current = {
      device, canvasContext, computePipeline, renderPipeline,
      boidBuffers, uniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroup, currentBuffer: 0,
    };
  }, [boidCount]);

  const resetBoids = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const data = createBoids(paramsRef.current.boidCount);
    gpu.device.queue.writeBuffer(gpu.boidBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.boidBuffers[1], 0, data);
    gpu.currentBuffer = 0;
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

    const uniforms = new Float32Array(16);
    uniforms[0] = dt;
    uniforms[1] = p.separation;
    uniforms[2] = p.alignment;
    uniforms[3] = p.cohesion;
    uniforms[4] = p.sepForce;
    uniforms[5] = p.aliForce;
    uniforms[6] = p.cohForce;
    uniforms[7] = p.maxSpeed;
    const u32 = new Uint32Array(uniforms.buffer);
    u32[8] = p.boidCount;
    uniforms[9] = m.x;
    uniforms[10] = m.y;
    uniforms[11] = m.pressed ? 1.0 : 0.0;
    uniforms[12] = p.paused ? 1.0 : 0.0;

    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, uniforms);

    const canvas = canvasRef.current!;
    const aspectRatio = canvas.width / canvas.height;
    const boidSize = 0.008;
    const renderU = new Float32Array([aspectRatio, boidSize, 0, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, renderU);

    const encoder = gpu.device.createCommandEncoder();

    const cpass = encoder.beginComputePass();
    cpass.setPipeline(gpu.computePipeline);
    cpass.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
    cpass.dispatchWorkgroups(Math.ceil(p.boidCount / 256));
    cpass.end();

    const outIdx = 1 - gpu.currentBuffer;

    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroup);
    rpass.setVertexBuffer(0, gpu.boidBuffers[outIdx]);
    rpass.draw(3, p.boidCount);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);
    gpu.currentBuffer = outIdx;

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

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouseRef.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };
    const onDown = () => { mouseRef.current.pressed = true; };
    const onUp = () => { mouseRef.current.pressed = false; };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
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
      window.removeEventListener('mouseup', onUp);
      if (gpuRef.current) {
        gpuRef.current.boidBuffers.forEach(b => b.destroy());
        gpuRef.current.uniformBuffer.destroy();
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
            <h1>Boids Flock</h1>
            <span className="badge">{boidCount} boids</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Boids Count <span className="value">{boidCount}</span></label>
            <input type="range" min="100" max="5000" step="100" value={boidCount}
              onChange={e => { setBoidCount(Number(e.target.value)); }} />
            <div className="range-values"><span>100</span><span>5,000</span></div>
          </div>

          <div className="control-group">
            <label>Separation <span className="value">{separation.toFixed(2)}</span></label>
            <input type="range" min="0.01" max="0.2" step="0.005" value={separation}
              onChange={e => setSeparation(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Alignment <span className="value">{alignment.toFixed(2)}</span></label>
            <input type="range" min="0.01" max="0.3" step="0.005" value={alignment}
              onChange={e => setAlignment(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Cohesion <span className="value">{cohesion.toFixed(2)}</span></label>
            <input type="range" min="0.01" max="0.3" step="0.005" value={cohesion}
              onChange={e => setCohesion(Number(e.target.value))} />
          </div>
          <div className="control-group">
            <label>Max Speed <span className="value">{maxSpeed.toFixed(2)}</span></label>
            <input type="range" min="0.1" max="2.0" step="0.05" value={maxSpeed}
              onChange={e => setMaxSpeed(Number(e.target.value))} />
          </div>

          <div className="control-group">
            <label>Forces</label>
            <div className="range-values" style={{ opacity: 1 }}>
              <span>Sep: {sepForce.toFixed(1)}</span>
              <span>Ali: {aliForce.toFixed(1)}</span>
              <span>Coh: {cohForce.toFixed(1)}</span>
            </div>
            <input type="range" min="0" max="5" step="0.1" value={sepForce}
              onChange={e => setSepForce(Number(e.target.value))} />
            <input type="range" min="0" max="5" step="0.1" value={aliForce}
              onChange={e => setAliForce(Number(e.target.value))} />
            <input type="range" min="0" max="5" step="0.1" value={cohForce}
              onChange={e => setCohForce(Number(e.target.value))} />
          </div>

          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetBoids}>↻ Reset</button>
          </div>

          <div className="hints">
            <span>Click: scatter boids (flee cursor)</span>
            <span>GPU-computed flocking: separation + alignment + cohesion</span>
          </div>
        </aside>
      </div>
    </div>
  );
};
