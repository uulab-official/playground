import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import waveComputeCode from '../shaders/wave_compute.wgsl?raw';
import waveRenderCode from '../shaders/wave_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const GRID_W = 512;
const GRID_H = 512;
const CELL_COUNT = GRID_W * GRID_H;
const BUF_SIZE = CELL_COUNT * 4; // f32 per cell

type PresetMode = 'none' | 'rain' | 'single' | 'ripple' | 'double-slit';
type ColorMode = 0 | 1 | 2 | 3;

const COLOR_LABELS = ['Ocean', 'Neon', 'Fire', 'Monochrome'] as const;

export const WaveEquationPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    heightBuffers: GPUBuffer[];       // 3 buffers: [0]=current, [1]=previous, [2]=output (logical roles rotate)
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[]; // 3 bind groups for rotation states
    renderBindGroups: GPUBindGroup[];  // 3 render bind groups
    bufferIndex: number;               // current rotation state 0, 1, or 2
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const frameRef = useRef(0);

  // UI state
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const [colorMode, setColorMode] = useState<ColorMode>(0);
  const [stepsPerFrame, setStepsPerFrame] = useState(2);
  const [waveSpeed, setWaveSpeed] = useState(1.0);
  const [damping, setDamping] = useState(0.997);
  const [dropStrength, setDropStrength] = useState(2.0);
  const [dropRadius, setDropRadius] = useState(5);
  const [preset, setPreset] = useState<PresetMode>('none');

  // Refs for render loop access
  const paramsRef = useRef({
    paused: false,
    colorMode: 0 as ColorMode,
    steps: 2,
    speed: 1.0,
    damping: 0.997,
    dropStrength: 2.0,
    dropRadius: 5,
    preset: 'none' as PresetMode,
  });
  const mouseRef = useRef({ x: 0, y: 0, active: 0 });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  // ────────────────── GPU INIT ──────────────────

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: waveComputeCode });
    const renderModule = device.createShaderModule({ code: waveRenderCode });

    // 3 height buffers (f32 storage)
    const heightBuffers = [0, 1, 2].map(() =>
      device.createBuffer({
        size: BUF_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    );

    // Zero-init all buffers
    const zeros = new Float32Array(CELL_COUNT);
    for (const buf of heightBuffers) {
      device.queue.writeBuffer(buf, 0, zeros);
    }

    // Compute uniform: 16 floats = 64 bytes
    const computeUB = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render uniform: 8 floats = 32 bytes
    const renderUB = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute bind group layout: uniform, current(read), previous(read), output(write)
    const cBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // current
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // previous
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },            // output
      ],
    });

    // 3 rotation states for triple buffering:
    // state 0: current=buf0, previous=buf1, output=buf2
    // state 1: current=buf2, previous=buf0, output=buf1
    // state 2: current=buf1, previous=buf2, output=buf0
    const rotations = [
      [0, 1, 2], // current, previous, output
      [2, 0, 1],
      [1, 2, 0],
    ];

    const computeBindGroups = rotations.map(([cur, prev, out]) =>
      device.createBindGroup({
        layout: cBGL,
        entries: [
          { binding: 0, resource: { buffer: computeUB } },
          { binding: 1, resource: { buffer: heightBuffers[cur] } },
          { binding: 2, resource: { buffer: heightBuffers[prev] } },
          { binding: 3, resource: { buffer: heightBuffers[out] } },
        ],
      })
    );

    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [cBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    // Render bind group layout: uniform + current height buffer
    const rBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    // 3 render bind groups, each reads from the "current" buffer at that rotation state
    const renderBindGroups = rotations.map(([cur]) =>
      device.createBindGroup({
        layout: rBGL,
        entries: [
          { binding: 0, resource: { buffer: renderUB } },
          { binding: 1, resource: { buffer: heightBuffers[cur] } },
        ],
      })
    );

    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [rBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device,
      canvasContext,
      computePipeline,
      renderPipeline,
      heightBuffers,
      computeUniformBuffer: computeUB,
      renderUniformBuffer: renderUB,
      computeBindGroups,
      renderBindGroups,
      bufferIndex: 0,
    };
  }, []);

  // ────────────────── CLEAR / RESET ──────────────────

  const clearBuffers = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const zeros = new Float32Array(CELL_COUNT);
    for (const buf of gpu.heightBuffers) {
      gpu.device.queue.writeBuffer(buf, 0, zeros);
    }
    gpu.bufferIndex = 0;
    frameRef.current = 0;
  }, []);

  const takeScreenshot = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement('a');
    a.download = `wave-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }, []);

  useSimKeyboard({
    onPause: () => setPaused(p => !p),
    onReset: clearBuffers,
    onScreenshot: takeScreenshot,
  });

  // ────────────────── PRESET HELPERS ──────────────────

  const applyDrop = useCallback((gx: number, gy: number, strength: number, radius: number) => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    // Write a circular splash into the current buffer
    const rotations = [[0, 1, 2], [2, 0, 1], [1, 2, 0]];
    const curBufIdx = rotations[gpu.bufferIndex][0];
    const data = new Float32Array(1);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const px = gx + dx;
        const py = gy + dy;
        if (px < 0 || px >= GRID_W || py < 0 || py >= GRID_H) continue;
        const idx = py * GRID_W + px;
        const falloff = 1.0 - dist / radius;
        data[0] = strength * falloff;
        gpu.device.queue.writeBuffer(gpu.heightBuffers[curBufIdx], idx * 4, data);
      }
    }
  }, []);

  const handlePresetStep = useCallback(() => {
    const p = paramsRef.current;
    const frame = frameRef.current;

    if (p.preset === 'rain' && frame % 10 === 0) {
      const gx = Math.floor(Math.random() * (GRID_W - 40)) + 20;
      const gy = Math.floor(Math.random() * (GRID_H - 40)) + 20;
      applyDrop(gx, gy, p.dropStrength, p.dropRadius);
    } else if (p.preset === 'ripple' && frame % 30 === 0) {
      applyDrop(Math.floor(GRID_W / 2), Math.floor(GRID_H / 2), p.dropStrength, p.dropRadius);
    } else if (p.preset === 'double-slit' && frame % 8 === 0) {
      // Two wave sources on the left side, separated vertically
      const sourceX = 20;
      const cy = Math.floor(GRID_H / 2);
      const slitSep = 40;
      applyDrop(sourceX, cy - slitSep, p.dropStrength * 0.8, Math.max(2, p.dropRadius - 2));
      applyDrop(sourceX, cy + slitSep, p.dropStrength * 0.8, Math.max(2, p.dropRadius - 2));
    }
  }, [applyDrop]);

  // ────────────────── RENDER LOOP ──────────────────

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    const p = paramsRef.current;
    const m = mouseRef.current;

    // Handle preset auto-drops before GPU work
    if (!p.paused) {
      handlePresetStep();
    }

    // Compute uniforms (16 floats = 64 bytes)
    const cu = new Float32Array(16);
    const cu32 = new Uint32Array(cu.buffer);
    cu32[0] = GRID_W;          // gridW
    cu32[1] = GRID_H;          // gridH
    cu[2] = p.damping;         // damping
    cu[3] = p.speed;           // speed
    cu[4] = m.x;               // mouseX (0-1 normalized)
    cu[5] = m.y;               // mouseY (0-1 normalized)
    cu32[6] = m.active;        // mouseActive
    cu[7] = p.dropRadius;      // mouseRadius
    cu32[8] = frameRef.current; // frame
    cu[9] = 1.0 / 60.0;       // dt
    cu[10] = p.dropStrength;   // dropStrength
    cu[11] = 0;                // pad
    cu[12] = 0;                // pad
    cu[13] = 0;                // pad
    cu[14] = 0;                // pad
    cu[15] = 0;                // pad
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Render uniforms (8 floats = 32 bytes)
    const ru = new Float32Array(8);
    const ru32 = new Uint32Array(ru.buffer);
    ru32[0] = GRID_W;         // gridW
    ru32[1] = GRID_H;         // gridH
    ru32[2] = p.colorMode;    // colorMode
    ru[3] = 0.5;              // lightX
    ru[4] = 1.0;              // lightY
    ru[5] = 0.5;              // lightZ
    ru[6] = 0;                // pad
    ru[7] = 0;                // pad
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const encoder = gpu.device.createCommandEncoder();

    // Run N compute steps
    const steps = p.paused ? 0 : p.steps;
    for (let s = 0; s < steps; s++) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(gpu.computePipeline);
      cp.setBindGroup(0, gpu.computeBindGroups[gpu.bufferIndex]);
      cp.dispatchWorkgroups(Math.ceil(GRID_W / 16), Math.ceil(GRID_H / 16));
      cp.end();
      // Rotate: output becomes current, current becomes previous
      gpu.bufferIndex = (gpu.bufferIndex + 1) % 3;
    }

    // After compute steps, the "current" in the new rotation state has the latest data.
    // Render using the bind group for the current rotation state.
    // After rotation, bufferIndex points to the state where buf[rotations[idx][0]] is the newest output.
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rpass.setPipeline(gpu.renderPipeline);
    rpass.setBindGroup(0, gpu.renderBindGroups[gpu.bufferIndex]);
    rpass.draw(4);
    rpass.end();

    gpu.device.queue.submit([encoder.finish()]);

    frameRef.current++;

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, [handlePresetStep]);

  // ────────────────── MOUSE / TOUCH ──────────────────

  const getGridCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / rect.width,
      y: 1 - (clientY - rect.top) / rect.height,
    };
  }, []);

  // ────────────────── LIFECYCLE ──────────────────

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

    // Mouse events
    const onMouseDown = (e: MouseEvent) => {
      const coords = getGridCoords(e.clientX, e.clientY);
      mouseRef.current = { x: coords.x, y: coords.y, active: 1 };
    };
    const onMouseMove = (e: MouseEvent) => {
      const coords = getGridCoords(e.clientX, e.clientY);
      mouseRef.current.x = coords.x;
      mouseRef.current.y = coords.y;
    };
    const onMouseUp = () => {
      mouseRef.current.active = 0;
    };

    // Touch events
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const coords = getGridCoords(touch.clientX, touch.clientY);
      mouseRef.current = { x: coords.x, y: coords.y, active: 1 };
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const coords = getGridCoords(touch.clientX, touch.clientY);
      mouseRef.current.x = coords.x;
      mouseRef.current.y = coords.y;
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      mouseRef.current.active = 0;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    fpsTime.current = performance.now();
    initGPU().then(() => {
      rafRef.current = requestAnimationFrame(render);
    });

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
        gpuRef.current.heightBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  // Sync React state to refs
  useEffect(() => { paramsRef.current.paused = paused; }, [paused]);
  useEffect(() => { paramsRef.current.colorMode = colorMode; }, [colorMode]);
  useEffect(() => { paramsRef.current.steps = stepsPerFrame; }, [stepsPerFrame]);
  useEffect(() => { paramsRef.current.speed = waveSpeed; }, [waveSpeed]);
  useEffect(() => { paramsRef.current.damping = damping; }, [damping]);
  useEffect(() => { paramsRef.current.dropStrength = dropStrength; }, [dropStrength]);
  useEffect(() => { paramsRef.current.dropRadius = dropRadius; }, [dropRadius]);
  useEffect(() => { paramsRef.current.preset = preset; }, [preset]);

  // When "single" preset is selected, fire one drop then revert to 'none'
  useEffect(() => {
    if (preset === 'single') {
      applyDrop(Math.floor(GRID_W / 2), Math.floor(GRID_H / 2), dropStrength, dropRadius);
      setPreset('none');
    }
  }, [preset, applyDrop, dropStrength, dropRadius]);

  const presetButtons: { id: PresetMode; label: string }[] = [
    { id: 'rain', label: 'Rain' },
    { id: 'single', label: 'Single Drop' },
    { id: 'ripple', label: 'Ripple' },
    { id: 'double-slit', label: 'Double Slit' },
  ];

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
        />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Wave Equation</h1>
            <span className="badge">{GRID_W}x{GRID_H}</span>
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
          {/* Wave Speed */}
          <div className="control-group">
            <label>Wave Speed <span className="value">{waveSpeed.toFixed(2)}</span></label>
            <input
              type="range" min="0.1" max="2.0" step="0.01" value={waveSpeed}
              onChange={e => setWaveSpeed(Number(e.target.value))}
            />
          </div>

          {/* Damping */}
          <div className="control-group">
            <label>Damping <span className="value">{damping.toFixed(4)}</span></label>
            <input
              type="range" min="0.99" max="1.0" step="0.0001" value={damping}
              onChange={e => setDamping(Number(e.target.value))}
            />
          </div>

          {/* Drop Strength */}
          <div className="control-group">
            <label>Drop Strength <span className="value">{dropStrength.toFixed(1)}</span></label>
            <input
              type="range" min="0.5" max="5.0" step="0.1" value={dropStrength}
              onChange={e => setDropStrength(Number(e.target.value))}
            />
          </div>

          {/* Drop Radius */}
          <div className="control-group">
            <label>Drop Radius <span className="value">{dropRadius}</span></label>
            <input
              type="range" min="1" max="20" step="1" value={dropRadius}
              onChange={e => setDropRadius(Number(e.target.value))}
            />
          </div>

          {/* Steps per Frame */}
          <div className="control-group">
            <label>Steps/Frame <span className="value">{stepsPerFrame}</span></label>
            <input
              type="range" min="1" max="8" step="1" value={stepsPerFrame}
              onChange={e => setStepsPerFrame(Number(e.target.value))}
            />
          </div>

          {/* Color Mode */}
          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {COLOR_LABELS.map((c, i) => (
                <button
                  key={c}
                  className={`preset-btn ${colorMode === i ? 'active' : ''}`}
                  onClick={() => setColorMode(i as ColorMode)}
                >
                  <span className="preset-label">{c}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Presets */}
          <div className="control-group">
            <label>Presets</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {presetButtons.map(p => (
                <button
                  key={p.id}
                  className={`preset-btn ${preset === p.id ? 'active' : ''}`}
                  onClick={() => {
                    if (preset === p.id && p.id !== 'single') {
                      setPreset('none');
                    } else {
                      setPreset(p.id);
                    }
                  }}
                >
                  <span className="preset-label">{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(!paused)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={clearBuffers}>↻ Clear</button>
            <button className="action-btn" onClick={takeScreenshot}>📷</button>
            <ShareButton canvasRef={canvasRef} title="Wave Equation" />
          </div>

          <div className="hints">
            <span>Click/drag to create waves</span>
            <span>2D wave equation · {GRID_W}x{GRID_H} grid</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay
        id="wave"
        steps={[
          { icon: '🖱️', title: '클릭', desc: '클릭/드래그로 파동 생성' },
          { icon: '💧', title: '프리셋', desc: '비/파문/이중슬릿 자동 파동' },
          { icon: '🌊', title: '색상 모드', desc: '바다/네온/불/흑백 4가지' },
          { icon: '⚙️', title: '물리', desc: '파동 속도, 감쇠, 세기 조절' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
