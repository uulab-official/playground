import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import nbodyComputeCode from '../shaders/nbody_compute.wgsl?raw';
import nbodyRenderCode from '../shaders/nbody_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const BODY_COUNT = 4096;
const BODY_STRIDE = 32; // 8 f32 per body

type PresetName = 'Galaxy' | 'Binary' | 'Ring' | 'Random';

function createBodies(preset: PresetName): ArrayBuffer {
  const buf = new ArrayBuffer(BODY_COUNT * 8 * 4);
  const data = new Float32Array(buf);

  if (preset === 'Galaxy') {
    // Central massive body
    data[0] = 0.0; data[1] = 0.0; data[2] = 0.0; data[3] = 0.0;
    data[4] = 50.0; data[5] = 0.0; data[6] = 0.0; data[7] = 0.0;

    for (let i = 1; i < BODY_COUNT; i++) {
      const idx = i * 8;
      const r = Math.pow(Math.random(), 0.4) * 0.7;
      const theta = Math.random() * Math.PI * 2;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const speed = Math.sqrt(r * 0.3);
      const vx = -Math.sin(theta) * speed + (Math.random() - 0.5) * 0.01;
      const vy = Math.cos(theta) * speed + (Math.random() - 0.5) * 0.01;
      data[idx + 0] = x;
      data[idx + 1] = y;
      data[idx + 2] = vx;
      data[idx + 3] = vy;
      data[idx + 4] = 1.0;
      data[idx + 5] = 0.0;
      data[idx + 6] = 0.0;
      data[idx + 7] = 0.0;
    }
  } else if (preset === 'Binary') {
    const half = BODY_COUNT / 2;
    for (let i = 0; i < BODY_COUNT; i++) {
      const idx = i * 8;
      const isA = i < half;
      const cx = isA ? -0.5 : 0.5;
      const r = Math.random() * 0.3;
      const theta = Math.random() * Math.PI * 2;
      const x = cx + r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const orbSpeed = Math.sqrt(r * 0.15 + 0.001);
      const vx = (isA ? 0.1 : -0.1) + (-Math.sin(theta) * orbSpeed);
      const vy = Math.cos(theta) * orbSpeed;
      data[idx + 0] = x;
      data[idx + 1] = y;
      data[idx + 2] = vx;
      data[idx + 3] = vy;
      data[idx + 4] = 1.0;
      data[idx + 5] = 0.0;
      data[idx + 6] = 0.0;
      data[idx + 7] = 0.0;
    }
  } else if (preset === 'Ring') {
    // Central heavy body
    data[0] = 0.0; data[1] = 0.0; data[2] = 0.0; data[3] = 0.0;
    data[4] = 100.0; data[5] = 0.0; data[6] = 0.0; data[7] = 0.0;

    for (let i = 1; i < BODY_COUNT; i++) {
      const idx = i * 8;
      const theta = (i / (BODY_COUNT - 1)) * Math.PI * 2;
      const r = 0.6;
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      const v = 0.15;
      const vx = -Math.sin(theta) * v;
      const vy = Math.cos(theta) * v;
      data[idx + 0] = x;
      data[idx + 1] = y;
      data[idx + 2] = vx;
      data[idx + 3] = vy;
      data[idx + 4] = 1.0;
      data[idx + 5] = 0.0;
      data[idx + 6] = 0.0;
      data[idx + 7] = 0.0;
    }
  } else {
    // Random
    for (let i = 0; i < BODY_COUNT; i++) {
      const idx = i * 8;
      data[idx + 0] = (Math.random() * 2 - 1) * 0.8;
      data[idx + 1] = (Math.random() * 2 - 1) * 0.8;
      data[idx + 2] = (Math.random() * 2 - 1) * 0.05;
      data[idx + 3] = (Math.random() * 2 - 1) * 0.05;
      data[idx + 4] = 0.5 + Math.random() * 1.5;
      data[idx + 5] = 0.0;
      data[idx + 6] = 0.0;
      data[idx + 7] = 0.0;
    }
  }

  return buf;
}

export const NBodyPage: React.FC = () => {
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
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const [preset, setPreset] = useState<PresetName>('Galaxy');
  const [colorMode, setColorMode] = useState(0);
  const [paused, setPaused] = useState(false);
  const [G, setG] = useState(0.0002);
  const [fps, setFps] = useState(0);

  const paramsRef = useRef({ preset: 'Galaxy' as PresetName, colorMode: 0, paused: false, G: 0.0002 });

  useEffect(() => {
    paramsRef.current = { preset, colorMode, paused, G };
  }, [preset, colorMode, paused, G]);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: nbodyComputeCode });
    const renderModule = device.createShaderModule({ code: nbodyRenderCode });

    const bodyByteSize = BODY_COUNT * BODY_STRIDE;
    const bodyBuffers = [0, 1].map(() =>
      device.createBuffer({
        size: bodyByteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    );

    const initialData = createBodies(paramsRef.current.preset);
    device.queue.writeBuffer(bodyBuffers[0], 0, initialData);
    device.queue.writeBuffer(bodyBuffers[1], 0, initialData);

    // Compute uniform: 32 bytes (8 x u32/f32)
    const computeUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Render uniform: 16 bytes (4 x u32/f32)
    const renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute BGL
    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    // computeBindGroups[i]: reads from bodyBuffers[i], writes to bodyBuffers[1-i]
    const computeBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: computeBGL,
        entries: [
          { binding: 0, resource: { buffer: computeUniformBuffer } },
          { binding: 1, resource: { buffer: bodyBuffers[i] } },
          { binding: 2, resource: { buffer: bodyBuffers[1 - i] } },
        ],
      })
    );

    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    // Render BGL
    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    // renderBindGroups[i]: reads from bodyBuffers[i]
    const renderBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: renderBGL,
        entries: [
          { binding: 0, resource: { buffer: renderUniformBuffer } },
          { binding: 1, resource: { buffer: bodyBuffers[i] } },
        ],
      })
    );

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
  }, []);

  const resetSimulation = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const data = createBodies(paramsRef.current.preset);
    gpu.device.queue.writeBuffer(gpu.bodyBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.bodyBuffers[1], 0, data);
    gpu.currentBuffer = 0;
  }, []);

  const takeScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `nbody-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  useSimKeyboard({
    onPause: () => setPaused(p => !p),
    onReset: resetSimulation,
    onScreenshot: takeScreenshot,
  });

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const p = paramsRef.current;

    // Write compute uniform: 32 bytes
    const cu = new Float32Array(8);
    const cu32 = new Uint32Array(cu.buffer);
    cu32[0] = BODY_COUNT;
    cu[1] = 0.0005; // dt
    cu[2] = p.G;
    cu[3] = 0.001;  // softening
    cu[4] = 0.999;  // damping
    // [5..7] = 0
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Write render uniform: 16 bytes
    const ru = new Float32Array(4);
    const ru32 = new Uint32Array(ru.buffer);
    ru32[0] = BODY_COUNT;
    ru32[1] = p.colorMode;
    ru[2] = 0.004;  // pointSize
    ru[3] = 0.0;
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const encoder = gpu.device.createCommandEncoder();

    // Compute pass (only when not paused)
    if (!p.paused) {
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(gpu.computePipeline);
      cpass.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
      cpass.dispatchWorkgroups(Math.ceil(BODY_COUNT / 64));
      cpass.end();

      // Swap AFTER compute, BEFORE render
      gpu.currentBuffer = 1 - gpu.currentBuffer;
    }

    // Render pass
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroups[gpu.currentBuffer]);
    rpass.draw(4, BODY_COUNT);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);

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

  // Handle preset change: update paramsRef then reset
  const handlePresetChange = useCallback((name: PresetName) => {
    setPreset(name);
    // paramsRef will be updated by the effect, but we need the new preset immediately
    paramsRef.current = { ...paramsRef.current, preset: name };
    const gpu = gpuRef.current;
    if (!gpu) return;
    const data = createBodies(name);
    gpu.device.queue.writeBuffer(gpu.bodyBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.bodyBuffers[1], 0, data);
    gpu.currentBuffer = 0;
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

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      if (gpuRef.current) {
        gpuRef.current.bodyBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  const presets: PresetName[] = ['Galaxy', 'Binary', 'Ring', 'Random'];
  const colorModes = ['Starfield', 'Speed', 'Mass'];

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>N-Body Gravity</h1>
            <span className="badge">{BODY_COUNT.toLocaleString()} bodies</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>
                {fps} FPS
              </span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Preset</label>
            <div className="preset-grid">
              {presets.map(name => (
                <button
                  key={name}
                  className={`preset-btn${preset === name ? ' active' : ''}`}
                  onClick={() => handlePresetChange(name)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group">
            <label>Gravity <span className="value">{G.toFixed(5)}</span></label>
            <input
              type="range"
              min="0.00005"
              max="0.001"
              step="0.00005"
              value={G}
              onChange={e => setG(Number(e.target.value))}
            />
            <div className="range-values"><span>0.00005</span><span>0.001</span></div>
          </div>

          <div className="control-group">
            <label>Color Mode</label>
            <div className="preset-grid">
              {colorModes.map((mode, i) => (
                <button
                  key={mode}
                  className={`preset-btn${colorMode === i ? ' active' : ''}`}
                  onClick={() => setColorMode(i)}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(p => !p)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetSimulation}>↻ Reset</button>
            <button className="action-btn" onClick={takeScreenshot}>📷</button>
            <ShareButton canvasRef={canvasRef} title="N-Body Gravity" />
          </div>

          <div className="hints">
            <span>4096 bodies · O(N²) all-pairs gravity · tile-shared memory</span>
          </div>
        </aside>
      </div>

      <TutorialOverlay
        id="nbody"
        steps={[
          { icon: '⭐', title: 'N-체계 중력', desc: '4096개 천체가 서로 중력으로 당깁니다' },
          { icon: '🌌', title: '프리셋', desc: 'Galaxy, Binary, Ring 등 다양한 초기 배치' },
          { icon: '🔭', title: '색상', desc: '속도나 질량 기준으로 색상 변경' },
          { icon: '⚡', title: 'GPU 가속', desc: 'O(N²) 전체쌍 계산을 타일 기반 공유메모리로 최적화' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
