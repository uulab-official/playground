import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import particleLifeComputeCode from '../shaders/particle_life_compute.wgsl?raw';
import particleLifeRenderCode  from '../shaders/particle_life_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const PARTICLE_COUNT = 10_000;
const NUM_SPECIES    = 6;

// --- Force matrix presets ---

function randomMatrix(): Float32Array {
  const m = new Float32Array(36);
  for (let i = 0; i < 36; i++) m[i] = Math.random() * 2 - 1;
  return m;
}

function harmonyMatrix(): Float32Array {
  const m = new Float32Array(36);
  for (let i = 0; i < 36; i++) m[i] = 0.3 + Math.random() * 0.5;
  return m;
}

function predatorMatrix(): Float32Array {
  // Species i strongly attracts species (i-1) mod 6, repels (i+1) mod 6
  const m = new Float32Array(36);
  for (let a = 0; a < NUM_SPECIES; a++) {
    for (let b = 0; b < NUM_SPECIES; b++) {
      const idx = a * NUM_SPECIES + b;
      const prev = (a - 1 + NUM_SPECIES) % NUM_SPECIES;
      const next = (a + 1) % NUM_SPECIES;
      if (b === prev) {
        m[idx] = 0.8;
      } else if (b === next) {
        m[idx] = -0.6;
      } else {
        m[idx] = (Math.random() - 0.5) * 0.3;
      }
    }
  }
  return m;
}

function symmetricMatrix(): Float32Array {
  // Diagonal: positive attraction to same species
  // Off-diagonal: random but symmetric
  const raw = new Float32Array(36);
  for (let a = 0; a < NUM_SPECIES; a++) {
    raw[a * NUM_SPECIES + a] = 0.5 + Math.random() * 0.4;
    for (let b = a + 1; b < NUM_SPECIES; b++) {
      const v = Math.random() * 2 - 1;
      raw[a * NUM_SPECIES + b] = v;
      raw[b * NUM_SPECIES + a] = v;
    }
  }
  return raw;
}

const PRESETS = ['Chaos', 'Harmony', 'Predator', 'Symmetric'] as const;
type PresetName = typeof PRESETS[number];

function buildMatrix(preset: PresetName): Float32Array {
  switch (preset) {
    case 'Chaos':     return randomMatrix();
    case 'Harmony':   return harmonyMatrix();
    case 'Predator':  return predatorMatrix();
    case 'Symmetric': return symmetricMatrix();
  }
}

// --- Uniform buffer helpers ---

// Compute uniform: 176 bytes
// [0] u32  particleCount
// [1] f32  dt
// [2] f32  friction
// [3] f32  rMax
// [4] f32  forceMagnitude
// [5..7]   pad (f32)
// [8..43]  forceMatrix (36 f32s, packed into 9 vec4s)
function writeComputeUniforms(
  buf: ArrayBuffer,
  particleCount: number,
  dt: number,
  friction: number,
  rMax: number,
  forceMagnitude: number,
  forceMatrix: Float32Array,
) {
  const f32View = new Float32Array(buf);
  const u32View = new Uint32Array(buf);
  u32View[0] = particleCount;
  f32View[1] = dt;
  f32View[2] = friction;
  f32View[3] = rMax;
  f32View[4] = forceMagnitude;
  // f32View[5..7] = pad (leave as 0)
  for (let i = 0; i < 36; i++) {
    f32View[8 + i] = forceMatrix[i];
  }
}

// --- Initial particle data ---
function createInitialParticles(count: number): ArrayBuffer {
  // Each particle: x, y, vx, vy (f32) + species, pad1, pad2, pad3 (u32)
  // = 8 x 4 bytes = 32 bytes per particle
  const buf = new ArrayBuffer(count * 32);
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  for (let i = 0; i < count; i++) {
    const base = i * 8;
    f32[base + 0] = Math.random(); // x
    f32[base + 1] = Math.random(); // y
    f32[base + 2] = 0;             // vx
    f32[base + 3] = 0;             // vy
    u32[base + 4] = i % NUM_SPECIES; // species
    // pad1, pad2, pad3 = 0
  }
  return buf;
}

export const ParticleLifePage: React.FC = () => {
  const navigate    = useNavigate();
  const canvasRef   = useRef<HTMLCanvasElement>(null);

  const gpuRef = useRef<{
    device:               GPUDevice;
    canvasContext:        GPUCanvasContext;
    computePipeline:      GPUComputePipeline;
    renderPipeline:       GPURenderPipeline;
    particleBuffers:      GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer:  GPUBuffer;
    computeBindGroups:    GPUBindGroup[];
    renderBindGroups:     GPUBindGroup[];
    currentBuffer:        number;
  } | null>(null);

  const rafRef    = useRef(0);
  const activeRef = useRef(true);
  const [fps, setFps]     = useState(0);
  const fpsFrames = useRef(0);
  const fpsTime   = useRef(performance.now());

  const [paused, setPaused]         = useState(false);
  const pausedRef                   = useRef(false);
  const [preset, setPreset]         = useState<PresetName>('Chaos');
  const [friction, setFriction]     = useState(0.92);
  const [rMax, setRMax]             = useState(0.1);

  // Mutable refs for render loop
  const frictionRef        = useRef(0.92);
  const rMaxRef            = useRef(0.1);
  const forceMatrixRef     = useRef<Float32Array>(buildMatrix('Chaos'));

  useEffect(() => { frictionRef.current = friction; }, [friction]);
  useEffect(() => { rMaxRef.current = rMax; }, [rMax]);

  // --- GPU init ---
  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: particleLifeComputeCode });
    const renderModule  = device.createShaderModule({ code: particleLifeRenderCode });

    // 32 bytes per particle
    const particleStride = 32;
    const bufferSize     = PARTICLE_COUNT * particleStride;

    const particleBuffers = [0, 1].map(() =>
      device.createBuffer({
        size:  bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    );

    // Upload initial data into buffer 0
    const initData = createInitialParticles(PARTICLE_COUNT);
    device.queue.writeBuffer(particleBuffers[0], 0, initData);

    // Compute uniform buffer: 176 bytes
    const computeUniformBuffer = device.createBuffer({
      size:  176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render uniform buffer: 16 bytes [aspectRatio, pointSize, pad, pad]
    const renderUniformBuffer = device.createBuffer({
      size:  16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute BGL: uniform + read-only-storage + storage
    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    // computeBindGroups[i]: reads from particleBuffers[i], writes to particleBuffers[1-i]
    const computeBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: computeBGL,
        entries: [
          { binding: 0, resource: { buffer: computeUniformBuffer } },
          { binding: 1, resource: { buffer: particleBuffers[i] } },
          { binding: 2, resource: { buffer: particleBuffers[1 - i] } },
        ],
      })
    );

    const computePipeline = device.createComputePipeline({
      layout:  device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'main' },
    });

    // Render BGL: uniform + read-only-storage
    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const renderBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: renderBGL,
        entries: [
          { binding: 0, resource: { buffer: renderUniformBuffer } },
          { binding: 1, resource: { buffer: particleBuffers[i] } },
        ],
      })
    );

    const renderPipeline = device.createRenderPipeline({
      layout:   device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
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

  // --- Render loop ---
  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const canvas = canvasRef.current!;
    const aspect = canvas.width / canvas.height;

    // Write compute uniforms
    const cuBuf = new ArrayBuffer(176);
    writeComputeUniforms(
      cuBuf,
      PARTICLE_COUNT,
      0.016,
      frictionRef.current,
      rMaxRef.current,
      1.0,
      forceMatrixRef.current,
    );
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cuBuf);

    // Write render uniforms: [aspectRatio, pointSize, 0, 0]
    const ruBuf = new Float32Array([aspect, 0.006, 0, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ruBuf);

    const encoder = gpu.device.createCommandEncoder();
    const inIdx   = gpu.currentBuffer;
    const outIdx  = 1 - inIdx;

    if (!pausedRef.current) {
      const cpass = encoder.beginComputePass();
      cpass.setPipeline(gpu.computePipeline);
      cpass.setBindGroup(0, gpu.computeBindGroups[inIdx]);
      cpass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64));
      cpass.end();
      // After compute, the output is in outIdx
      gpu.currentBuffer = outIdx;
    }

    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view:       gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    // Render from the buffer that was most recently written
    rpass.setBindGroup(0, gpu.renderBindGroups[gpu.currentBuffer]);
    rpass.draw(4, PARTICLE_COUNT);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round(fpsFrames.current * 1000 / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current   = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  // --- Reset particles ---
  const resetParticles = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const initData = createInitialParticles(PARTICLE_COUNT);
    gpu.device.queue.writeBuffer(gpu.particleBuffers[0], 0, initData);
    gpu.device.queue.writeBuffer(gpu.particleBuffers[1], 0, initData);
    gpu.currentBuffer = 0;
  }, []);

  // --- Lifecycle ---
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

    initGPU().then(() => {
      rafRef.current = requestAnimationFrame(render);
    });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [initGPU, render]);

  // --- Keyboard shortcuts ---
  useSimKeyboard({
    onPause: () => { const next = !pausedRef.current; setPaused(next); pausedRef.current = next; },
    onReset: resetParticles,
  });

  // --- UI handlers ---
  const applyPreset = useCallback((p: PresetName) => {
    setPreset(p);
    forceMatrixRef.current = buildMatrix(p);
  }, []);

  const handleRandomize = useCallback(() => {
    forceMatrixRef.current = buildMatrix(preset);
  }, [preset]);

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
            <h1>Particle Life</h1>
            <span className="badge">{(PARTICLE_COUNT / 1000).toFixed(0)}K particles</span>
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
          {/* Preset selector */}
          <div className="control-group">
            <label>Behaviour Preset</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {PRESETS.map(p => (
                <button
                  key={p}
                  className={`preset-btn${preset === p ? ' active' : ''}`}
                  onClick={() => applyPreset(p)}
                >
                  <span className="preset-label">{p}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="control-group">
            <label>Friction: {friction.toFixed(2)}</label>
            <input
              type="range" min="0.85" max="0.99" step="0.01"
              value={friction}
              onChange={e => { const v = parseFloat(e.target.value); setFriction(v); frictionRef.current = v; }}
              style={{ width: '100%' }}
            />
          </div>

          <div className="control-group">
            <label>Interaction Radius: {rMax.toFixed(2)}</label>
            <input
              type="range" min="0.05" max="0.3" step="0.005"
              value={rMax}
              onChange={e => { const v = parseFloat(e.target.value); setRMax(v); rMaxRef.current = v; }}
              style={{ width: '100%' }}
            />
          </div>

          {/* Actions */}
          <div className="control-group actions-row">
            <button
              className="action-btn primary"
              onClick={() => { const next = !pausedRef.current; setPaused(next); pausedRef.current = next; }}
            >
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={handleRandomize}>
              🎲 Randomize
            </button>
            <button className="action-btn" onClick={resetParticles}>
              ↺ Reset
            </button>
            <ShareButton canvasRef={canvasRef} title="Particle Life" params={preset} />
          </div>

          <div className="hints">
            <span>Space = pause · R = reset particles</span>
            <span>Pick a preset, then Randomize for variations</span>
          </div>
        </aside>
      </div>

      <TutorialOverlay
        id="particle-life"
        steps={[
          { icon: '🧬', title: 'Particle Life', desc: '10K particles of 6 species interact with species-specific attraction and repulsion rules on the GPU.' },
          { icon: '🎲', title: 'Presets', desc: 'Choose Chaos, Harmony, Predator, or Symmetric — each produces completely different emergent behaviour.' },
          { icon: '🔧', title: 'Tune It', desc: 'Adjust Friction and Interaction Radius, then hit Randomize to re-roll the force matrix within the same preset.' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
