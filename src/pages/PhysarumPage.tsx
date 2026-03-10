import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';
import agentsCode from '../shaders/physarum_agents.wgsl?raw';
import trailCode  from '../shaders/physarum_trail.wgsl?raw';
import renderCode from '../shaders/physarum_render.wgsl?raw';

const GRID        = 512;
const AGENT_COUNT = 200_000;

// ─── presets ─────────────────────────────────────────────────────────────────

type PresetKey = 'classic' | 'wanderer' | 'tendrils' | 'pulse';

interface SimParams {
  sensorAngle: number;
  sensorDist:  number;
  rotateAngle: number;
  speed:       number;
  decay:       number;
  deposit:     number;
  colorMode:   number;
}

const PRESETS: Record<PresetKey, SimParams & { label: string }> = {
  classic:  { label: 'Classic',   sensorAngle: 0.785, sensorDist: 9,  rotateAngle: 0.392, speed: 1.5,  decay: 0.96, deposit: 5,   colorMode: 0 },
  wanderer: { label: 'Wanderer',  sensorAngle: 1.047, sensorDist: 14, rotateAngle: 0.523, speed: 2.0,  decay: 0.94, deposit: 4,   colorMode: 1 },
  tendrils: { label: 'Tendrils',  sensorAngle: 0.524, sensorDist: 6,  rotateAngle: 0.262, speed: 1.0,  decay: 0.97, deposit: 8,   colorMode: 2 },
  pulse:    { label: 'Pulse',     sensorAngle: 1.309, sensorDist: 18, rotateAngle: 0.654, speed: 2.5,  decay: 0.92, deposit: 3,   colorMode: 0 },
};

// ─── agent initialisation ────────────────────────────────────────────────────

function createAgents(count: number): ArrayBuffer {
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4 + 0] = Math.random() * GRID;
    data[i * 4 + 1] = Math.random() * GRID;
    data[i * 4 + 2] = Math.random() * Math.PI * 2;
    data[i * 4 + 3] = 0;
  }
  return data.buffer;
}

// ─── GPU resource bundle ─────────────────────────────────────────────────────

interface GPUResources {
  device:               GPUDevice;
  canvasContext:        GPUCanvasContext;
  agentBuffers:         GPUBuffer[];   // [2] ping-pong
  trailBuffers:         GPUBuffer[];   // [2] ping-pong (u32 atomics)
  agentUniformBuffer:   GPUBuffer;
  trailUniformBuffer:   GPUBuffer;
  renderUniformBuffer:  GPUBuffer;
  agentPipeline:        GPUComputePipeline;
  trailPipeline:        GPUComputePipeline;
  renderPipeline:       GPURenderPipeline;
  agentBindGroups:      GPUBindGroup[];  // [4] = 2 agentIdx × 2 trailIdx
  trailBindGroups:      GPUBindGroup[];  // [2] = 2 trailIdx
  renderBindGroups:     GPUBindGroup[];  // [2] = 2 trailIdx
  agentIdx:             number;
  trailIdx:             number;
}

// ─── page component ──────────────────────────────────────────────────────────

export const PhysarumPage: React.FC = () => {
  const navigate    = useNavigate();
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const gpuRef      = useRef<GPUResources | null>(null);
  const rafRef      = useRef(0);
  const activeRef   = useRef(true);
  const frameRef    = useRef(0);
  const paramsRef   = useRef<SimParams & { paused: boolean }>({
    ...PRESETS.classic,
    paused: false,
  });

  const [preset,     setPreset]     = useState<PresetKey>('classic');
  const [paused,     setPaused]     = useState(false);
  const [colorMode,  setColorMode]  = useState(0);
  const [sensorAngle, setSensorAngle] = useState(PRESETS.classic.sensorAngle);
  const [sensorDist,  setSensorDist]  = useState(PRESETS.classic.sensorDist);
  const [rotateAngle, setRotateAngle] = useState(PRESETS.classic.rotateAngle);
  const [speed,       setSpeed]       = useState(PRESETS.classic.speed);
  const [decay,       setDecay]       = useState(PRESETS.classic.decay);
  const [fps,         setFps]         = useState(0);

  const fpsFrames = useRef(0);
  const fpsTime   = useRef(0);

  // ── GPU init ────────────────────────────────────────────────────────────────

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    // Compile shaders
    const agentModule  = device.createShaderModule({ code: agentsCode });
    const trailModule  = device.createShaderModule({ code: trailCode  });
    const renderModule = device.createShaderModule({ code: renderCode });

    // Buffers
    const agentBufSize = AGENT_COUNT * 16; // 4 × f32
    const trailBufSize = GRID * GRID * 4;  // u32 per cell

    const agentBuffers = [0, 1].map(() =>
      device.createBuffer({
        size:  agentBufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );

    const trailBuffers = [0, 1].map(() =>
      device.createBuffer({
        size:  trailBufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );

    // Seed agents into both agent buffers (identical initial state)
    const agentData = createAgents(AGENT_COUNT);
    device.queue.writeBuffer(agentBuffers[0], 0, agentData);
    device.queue.writeBuffer(agentBuffers[1], 0, agentData);

    // Trail buffers start as all-zero
    const zeros = new Uint8Array(trailBufSize);
    device.queue.writeBuffer(trailBuffers[0], 0, zeros);
    device.queue.writeBuffer(trailBuffers[1], 0, zeros);

    // Uniform buffers
    const agentUniformBuffer  = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const trailUniformBuffer  = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const renderUniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // ── bind group layouts ──────────────────────────────────────────────────

    // Agent BGL: uniform | read-only-storage (agentsIn) | storage (agentsOut) | storage (trailMap atomic)
    const agentBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    // Trail BGL: uniform | storage (trailIn atomic) | storage (trailOut)
    const trailBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    // Render BGL: uniform | read-only-storage (trail u32)
    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    // ── pipelines ───────────────────────────────────────────────────────────

    const agentPipeline = device.createComputePipeline({
      layout:  device.createPipelineLayout({ bindGroupLayouts: [agentBGL] }),
      compute: { module: agentModule, entryPoint: 'cs_main' },
    });

    const trailPipeline = device.createComputePipeline({
      layout:  device.createPipelineLayout({ bindGroupLayouts: [trailBGL] }),
      compute: { module: trailModule, entryPoint: 'cs_main' },
    });

    const renderPipeline = device.createRenderPipeline({
      layout:    device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex:    { module: renderModule, entryPoint: 'vs_main' },
      fragment:  { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    // ── bind groups ─────────────────────────────────────────────────────────
    //
    // agentBindGroups[aIdx * 2 + tIdx]:
    //   agentsIn  = agentBuffers[aIdx]
    //   agentsOut = agentBuffers[1-aIdx]
    //   trailMap  = trailBuffers[tIdx]  (deposit target = current trail)
    //
    // trailBindGroups[tIdx]:
    //   trailIn  = trailBuffers[tIdx]
    //   trailOut = trailBuffers[1-tIdx]
    //
    // renderBindGroups[tIdx]:  reads trailBuffers[tIdx]
    //   (after trail pass trailIdx has been swapped, so we read the *new* trail)

    const agentBindGroups: GPUBindGroup[] = [];
    for (let aIdx = 0; aIdx < 2; aIdx++) {
      for (let tIdx = 0; tIdx < 2; tIdx++) {
        agentBindGroups[aIdx * 2 + tIdx] = device.createBindGroup({
          layout:  agentBGL,
          entries: [
            { binding: 0, resource: { buffer: agentUniformBuffer } },
            { binding: 1, resource: { buffer: agentBuffers[aIdx]      } },
            { binding: 2, resource: { buffer: agentBuffers[1 - aIdx]  } },
            { binding: 3, resource: { buffer: trailBuffers[tIdx]      } },
          ],
        });
      }
    }

    const trailBindGroups: GPUBindGroup[] = [0, 1].map(tIdx =>
      device.createBindGroup({
        layout:  trailBGL,
        entries: [
          { binding: 0, resource: { buffer: trailUniformBuffer     } },
          { binding: 1, resource: { buffer: trailBuffers[tIdx]     } },
          { binding: 2, resource: { buffer: trailBuffers[1 - tIdx] } },
        ],
      }),
    );

    const renderBindGroups: GPUBindGroup[] = [0, 1].map(tIdx =>
      device.createBindGroup({
        layout:  renderBGL,
        entries: [
          { binding: 0, resource: { buffer: renderUniformBuffer } },
          { binding: 1, resource: { buffer: trailBuffers[tIdx]  } },
        ],
      }),
    );

    gpuRef.current = {
      device, canvasContext,
      agentBuffers, trailBuffers,
      agentUniformBuffer, trailUniformBuffer, renderUniformBuffer,
      agentPipeline, trailPipeline, renderPipeline,
      agentBindGroups, trailBindGroups, renderBindGroups,
      agentIdx: 0,
      trailIdx: 0,
    };
  }, []);

  // ── reset agents (keep trail) ───────────────────────────────────────────────

  const resetSim = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const agentData = createAgents(AGENT_COUNT);
    gpu.device.queue.writeBuffer(gpu.agentBuffers[0], 0, agentData);
    gpu.device.queue.writeBuffer(gpu.agentBuffers[1], 0, agentData);
    const zeros = new Uint8Array(GRID * GRID * 4);
    gpu.device.queue.writeBuffer(gpu.trailBuffers[0], 0, zeros);
    gpu.device.queue.writeBuffer(gpu.trailBuffers[1], 0, zeros);
    gpu.agentIdx = 0;
    gpu.trailIdx = 0;
    frameRef.current = 0;
  }, []);

  // ── render loop ─────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const p = paramsRef.current;

    if (!p.paused) {
      frameRef.current++;

      // Write agent uniform (48 bytes)
      const au    = new ArrayBuffer(48);
      const auU32 = new Uint32Array(au);
      const auF32 = new Float32Array(au);
      auU32[0] = GRID;
      auU32[1] = GRID;
      auU32[2] = AGENT_COUNT;
      auU32[3] = frameRef.current;
      auF32[4] = p.sensorAngle;
      auF32[5] = p.sensorDist;
      auF32[6] = p.rotateAngle;
      auF32[7] = p.speed;
      auF32[8] = p.deposit;
      // [9,10,11] = 0 (padding, already zero-initialised)
      gpu.device.queue.writeBuffer(gpu.agentUniformBuffer, 0, au);

      // Write trail uniform (16 bytes)
      const tu    = new ArrayBuffer(16);
      const tuU32 = new Uint32Array(tu);
      const tuF32 = new Float32Array(tu);
      tuU32[0] = GRID;
      tuU32[1] = GRID;
      tuF32[2] = p.decay;
      tuF32[3] = 1.0;
      gpu.device.queue.writeBuffer(gpu.trailUniformBuffer, 0, tu);

      const encoder = gpu.device.createCommandEncoder();

      // 1. Agent pass: read agentBuffers[agentIdx], write agentBuffers[1-agentIdx]
      //    deposit atomically into trailBuffers[trailIdx]
      {
        const cp = encoder.beginComputePass();
        cp.setPipeline(gpu.agentPipeline);
        cp.setBindGroup(0, gpu.agentBindGroups[gpu.agentIdx * 2 + gpu.trailIdx]);
        cp.dispatchWorkgroups(Math.ceil(AGENT_COUNT / 64));
        cp.end();
      }
      gpu.agentIdx = 1 - gpu.agentIdx;

      // 2. Trail pass: read trailBuffers[trailIdx] (with deposits), write trailBuffers[1-trailIdx]
      {
        const cp = encoder.beginComputePass();
        cp.setPipeline(gpu.trailPipeline);
        cp.setBindGroup(0, gpu.trailBindGroups[gpu.trailIdx]);
        cp.dispatchWorkgroups(Math.ceil(GRID / 16), Math.ceil(GRID / 16));
        cp.end();
      }
      gpu.trailIdx = 1 - gpu.trailIdx;

      // Write render uniform — always done before render pass
      const ru = new Uint32Array([GRID, GRID, p.colorMode, 0]);
      gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

      // 3. Render pass: read trailBuffers[trailIdx] (the freshly diffused trail)
      const rp = encoder.beginRenderPass({
        colorAttachments: [{
          view:       gpu.canvasContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
          loadOp:     'clear',
          storeOp:    'store',
        }],
      });
      rp.setPipeline(gpu.renderPipeline);
      rp.setBindGroup(0, gpu.renderBindGroups[gpu.trailIdx]);
      rp.draw(4);
      rp.end();

      gpu.device.queue.submit([encoder.finish()]);
    } else {
      // Still need to render when paused (just no compute)
      const ru = new Uint32Array([GRID, GRID, p.colorMode, 0]);
      gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

      const encoder = gpu.device.createCommandEncoder();
      const rp = encoder.beginRenderPass({
        colorAttachments: [{
          view:       gpu.canvasContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0.02, a: 1 },
          loadOp:     'clear',
          storeOp:    'store',
        }],
      });
      rp.setPipeline(gpu.renderPipeline);
      rp.setBindGroup(0, gpu.renderBindGroups[gpu.trailIdx]);
      rp.draw(4);
      rp.end();
      gpu.device.queue.submit([encoder.finish()]);
    }

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current   = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  // ── lifecycle ────────────────────────────────────────────────────────────────

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr    = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width  = canvas.clientWidth  * dpr;
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
      const gpu = gpuRef.current;
      if (gpu) {
        gpu.agentBuffers.forEach(b => b.destroy());
        gpu.trailBuffers.forEach(b => b.destroy());
        gpu.agentUniformBuffer.destroy();
        gpu.trailUniformBuffer.destroy();
        gpu.renderUniformBuffer.destroy();
        gpu.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync react state → paramsRef
  useEffect(() => { paramsRef.current.paused      = paused;      }, [paused]);
  useEffect(() => { paramsRef.current.colorMode   = colorMode;   }, [colorMode]);
  useEffect(() => { paramsRef.current.sensorAngle = sensorAngle; }, [sensorAngle]);
  useEffect(() => { paramsRef.current.sensorDist  = sensorDist;  }, [sensorDist]);
  useEffect(() => { paramsRef.current.rotateAngle = rotateAngle; }, [rotateAngle]);
  useEffect(() => { paramsRef.current.speed       = speed;       }, [speed]);
  useEffect(() => { paramsRef.current.decay       = decay;       }, [decay]);

  // Apply preset
  const applyPreset = useCallback((key: PresetKey) => {
    const p = PRESETS[key];
    setPreset(key);
    setColorMode(p.colorMode);
    setSensorAngle(p.sensorAngle);
    setSensorDist(p.sensorDist);
    setRotateAngle(p.rotateAngle);
    setSpeed(p.speed);
    setDecay(p.decay);
    paramsRef.current = { ...p, paused: paramsRef.current.paused };
    resetSim();
  }, [resetSim]);

  // Keyboard shortcuts
  useSimKeyboard({
    onPause:      () => setPaused(v => !v),
    onReset:      () => resetSim(),
    onScreenshot: () => {
      const c = canvasRef.current;
      if (!c) return;
      const a     = document.createElement('a');
      a.download  = `physarum-${preset}-${Date.now()}.png`;
      a.href      = c.toDataURL('image/png');
      a.click();
    },
  });

  const colorModes = ['Slime', 'Plasma', 'Fire'];

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
            <h1>Physarum</h1>
            <span className="badge">{PRESETS[preset].label}</span>
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
          {/* Presets */}
          <div className="control-group">
            <label>Preset</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {(Object.keys(PRESETS) as PresetKey[]).map(k => (
                <button
                  key={k}
                  className={`preset-btn ${preset === k ? 'active' : ''}`}
                  onClick={() => applyPreset(k)}
                >
                  <span className="preset-label">{PRESETS[k].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color Mode */}
          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {colorModes.map((c, i) => (
                <button
                  key={c}
                  className={`preset-btn ${colorMode === i ? 'active' : ''}`}
                  onClick={() => setColorMode(i)}
                >
                  <span className="preset-label">{c}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="control-group">
            <label>
              Sensor Angle <span className="value">{sensorAngle.toFixed(2)} rad</span>
            </label>
            <input
              type="range" min="0.1" max="1.5" step="0.01"
              value={sensorAngle}
              onChange={e => setSensorAngle(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>
              Sensor Distance <span className="value">{sensorDist.toFixed(1)} px</span>
            </label>
            <input
              type="range" min="3" max="20" step="0.5"
              value={sensorDist}
              onChange={e => setSensorDist(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>
              Speed <span className="value">{speed.toFixed(2)} px/frame</span>
            </label>
            <input
              type="range" min="0.5" max="3.0" step="0.05"
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>
              Decay <span className="value">{decay.toFixed(3)}</span>
            </label>
            <input
              type="range" min="0.90" max="0.99" step="0.001"
              value={decay}
              onChange={e => setDecay(Number(e.target.value))}
            />
          </div>

          {/* Actions */}
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(v => !v)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetSim}>↻ Reset</button>
            <ShareButton canvasRef={canvasRef} title="Physarum" />
          </div>

          <div className="hints">
            <span>Space = pause · R = reset · Esc = home</span>
            <span>{AGENT_COUNT.toLocaleString()} agents · {GRID}×{GRID} trail</span>
          </div>
        </aside>
      </div>

      <TutorialOverlay
        id="physarum"
        steps={[
          { icon: '🍄', title: 'Physarum',   desc: '슬라임 곰팡이 에이전트가 페로몬 경로를 따라 유기적 네트워크를 만듭니다.' },
          { icon: '📡', title: '센서',       desc: '각 에이전트는 3방향으로 trail을 감지해 가장 강한 쪽으로 방향을 전환합니다.' },
          { icon: '🎛️', title: '파라미터',   desc: 'Sensor Angle/Distance와 Speed를 조절해 완전히 다른 패턴을 만들어보세요.' },
          { icon: '🌈', title: '색상 모드',  desc: 'Slime(초록), Plasma(파랑-마젠타), Fire(불꽃) 3가지 시각화를 제공합니다.' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
