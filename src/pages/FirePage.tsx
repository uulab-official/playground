import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';
import fireComputeCode from '../shaders/fire_compute.wgsl?raw';
import fireRenderCode from '../shaders/fire_render.wgsl?raw';

const GRID = 512;

type FirePreset = 'classic' | 'wildfire' | 'blizzard';
const PRESETS: Record<FirePreset, { cooling: number; turbulence: number; colorMode: number; label: string }> = {
  classic:  { cooling: 0.97,  turbulence: 2.0, colorMode: 0, label: 'Classic' },
  wildfire: { cooling: 0.94,  turbulence: 3.5, colorMode: 0, label: 'Wildfire' },
  blizzard: { cooling: 0.985, turbulence: 1.5, colorMode: 2, label: 'Blizzard' },
};

const COLOR_MODES = ['Fire', 'Plasma', 'Ice'];

export const FirePage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    heatBuffers: GPUBuffer[];
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    currentBuffer: number;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const frameRef = useRef(0);

  const [preset, setPreset] = useState<FirePreset>('classic');
  const [paused, setPaused] = useState(false);
  const [colorMode, setColorMode] = useState(0);
  const [cooling, setCooling] = useState(0.97);
  const [turbulence, setTurbulence] = useState(2.0);
  const [stepsPerFrame, setStepsPerFrame] = useState(1);
  const [fps, setFps] = useState(0);

  const paramsRef = useRef({
    paused: false,
    colorMode: 0,
    cooling: 0.97,
    turbulence: 2.0,
    steps: 1,
  });
  const mouseRef = useRef({ x: 0, y: 0, pressed: false });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: fireComputeCode });
    const renderModule = device.createShaderModule({ code: fireRenderCode });

    const bufSize = GRID * GRID * 4; // f32 per cell
    const heatBuffers = [0, 1].map(() =>
      device.createBuffer({
        size: bufSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    );

    const computeUB = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const renderUB = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const cBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const computeBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: cBGL,
        entries: [
          { binding: 0, resource: { buffer: computeUB } },
          { binding: 1, resource: { buffer: heatBuffers[i] } },
          { binding: 2, resource: { buffer: heatBuffers[1 - i] } },
        ],
      })
    );
    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [cBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    const rBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });
    const renderBindGroups = [0, 1].map(i =>
      device.createBindGroup({
        layout: rBGL,
        entries: [
          { binding: 0, resource: { buffer: renderUB } },
          { binding: 1, resource: { buffer: heatBuffers[i] } },
        ],
      })
    );
    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [rBGL] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext, computePipeline, renderPipeline,
      heatBuffers, computeUniformBuffer: computeUB, renderUniformBuffer: renderUB,
      computeBindGroups, renderBindGroups, currentBuffer: 0,
    };
  }, []);

  const resetHeat = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const zeros = new Float32Array(GRID * GRID);
    gpu.device.queue.writeBuffer(gpu.heatBuffers[0], 0, zeros);
    gpu.device.queue.writeBuffer(gpu.heatBuffers[1], 0, zeros);
    gpu.currentBuffer = 0;
    frameRef.current = 0;
  }, []);

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const p = paramsRef.current;
    const m = mouseRef.current;

    // Compute uniform (32 bytes = 8 x 4 bytes)
    const cu = new Float32Array(8);
    const cu32 = new Uint32Array(cu.buffer);
    cu32[0] = GRID;
    cu32[1] = GRID;
    cu[2] = p.cooling;
    cu[3] = p.turbulence;
    cu[4] = m.x;
    cu[5] = m.y;
    cu32[6] = m.pressed ? 1 : 0;
    cu32[7] = frameRef.current++;
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, cu);

    // Render uniform (16 bytes)
    const ru = new Uint32Array([GRID, GRID, p.colorMode, 0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, ru);

    const encoder = gpu.device.createCommandEncoder();

    const steps = p.paused ? 0 : p.steps;
    for (let s = 0; s < steps; s++) {
      const cp = encoder.beginComputePass();
      cp.setPipeline(gpu.computePipeline);
      cp.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
      cp.dispatchWorkgroups(Math.ceil(GRID / 16), Math.ceil(GRID / 16));
      cp.end();
      gpu.currentBuffer = 1 - gpu.currentBuffer;
    }

    const rp = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    rp.setPipeline(gpu.renderPipeline);
    rp.setBindGroup(0, gpu.renderBindGroups[gpu.currentBuffer]);
    rp.draw(4);
    rp.end();

    gpu.device.queue.submit([encoder.finish()]);

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

    const setPos = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      mouseRef.current.x = (clientX - r.left) / r.width;
      mouseRef.current.y = (clientY - r.top) / r.height;
    };
    const onMove = (e: MouseEvent) => setPos(e.clientX, e.clientY);
    const onDown = (e: MouseEvent) => { mouseRef.current.pressed = true; setPos(e.clientX, e.clientY); };
    const onUp = () => { mouseRef.current.pressed = false; };
    const onTouchStart = (e: TouchEvent) => { e.preventDefault(); mouseRef.current.pressed = true; setPos(e.touches[0].clientX, e.touches[0].clientY); };
    const onTouchMove = (e: TouchEvent) => { e.preventDefault(); setPos(e.touches[0].clientX, e.touches[0].clientY); };
    const onTouchEnd = () => { mouseRef.current.pressed = false; };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      if (gpuRef.current) {
        gpuRef.current.heatBuffers.forEach(b => b.destroy());
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  useEffect(() => { paramsRef.current.paused = paused; }, [paused]);
  useEffect(() => { paramsRef.current.colorMode = colorMode; }, [colorMode]);
  useEffect(() => { paramsRef.current.cooling = cooling; }, [cooling]);
  useEffect(() => { paramsRef.current.turbulence = turbulence; }, [turbulence]);
  useEffect(() => { paramsRef.current.steps = stepsPerFrame; }, [stepsPerFrame]);

  const applyPreset = useCallback((key: FirePreset) => {
    const p = PRESETS[key];
    setCooling(p.cooling);
    setTurbulence(p.turbulence);
    setColorMode(p.colorMode);
    paramsRef.current.cooling = p.cooling;
    paramsRef.current.turbulence = p.turbulence;
    paramsRef.current.colorMode = p.colorMode;
    setPreset(key);
    resetHeat();
  }, [resetHeat]);

  const takeScreenshot = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const a = document.createElement('a');
    a.download = `fire-${preset}-${Date.now()}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  }, [preset]);

  useSimKeyboard({
    onPause: () => setPaused(v => !v),
    onReset: resetHeat,
    onScreenshot: takeScreenshot,
  });

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
            <h1>Fire Simulation</h1>
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
          <div className="control-group">
            <label>Preset</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {(Object.entries(PRESETS) as [FirePreset, typeof PRESETS.classic][]).map(([k, v]) => (
                <button
                  key={k}
                  className={`preset-btn ${preset === k ? 'active' : ''}`}
                  onClick={() => applyPreset(k)}
                >
                  <span className="preset-label">{v.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>Color</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {COLOR_MODES.map((c, i) => (
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
          <div className="control-group">
            <label>Cooling <span className="value">{cooling.toFixed(3)}</span></label>
            <input
              type="range" min="0.90" max="0.99" step="0.001"
              value={cooling}
              onChange={e => setCooling(Number(e.target.value))}
            />
          </div>
          <div className="control-group">
            <label>Turbulence <span className="value">{turbulence.toFixed(1)}</span></label>
            <input
              type="range" min="0.5" max="4.0" step="0.1"
              value={turbulence}
              onChange={e => setTurbulence(Number(e.target.value))}
            />
          </div>
          <div className="control-group">
            <label>Speed <span className="value">{stepsPerFrame} step{stepsPerFrame > 1 ? 's' : ''}/frame</span></label>
            <input
              type="range" min="1" max="8" step="1"
              value={stepsPerFrame}
              onChange={e => setStepsPerFrame(Number(e.target.value))}
            />
          </div>
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={() => setPaused(v => !v)}>
              {paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={resetHeat}>↻ Reset</button>
            <button className="action-btn" onClick={takeScreenshot}>📷</button>
            <ShareButton canvasRef={canvasRef} title="Fire Simulation" />
          </div>
          <div className="hints">
            <span>Click/drag to add heat</span>
            <span>Cellular automaton · {GRID}×{GRID} grid</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay
        id="fire"
        steps={[
          { icon: '🔥', title: '클릭으로 불꽃 추가', desc: '마우스를 클릭하거나 드래그해서 열을 추가하세요' },
          { icon: '🎛️', title: '프리셋 선택', desc: 'Classic, Wildfire, Blizzard 중 선택하세요' },
          { icon: '🌈', title: '색상 모드', desc: 'Fire, Plasma, Ice 3가지 색상 테마' },
          { icon: '💨', title: '난류 조절', desc: 'Turbulence 슬라이더로 바람의 세기를 조절하세요' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
