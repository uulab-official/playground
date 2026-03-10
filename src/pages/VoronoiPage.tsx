import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import voronoiCode from '../shaders/voronoi.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const MAX_SEEDS   = 64;
const NUM_SEEDS   = 32;
const COLOR_MODES = ['Cell', 'Distance', 'Smooth'] as const;
const SEED_COUNTS = [8, 16, 32, 64] as const;

// HSV → RGB helper (for initial seed colors)
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c  = v * s;
  const hp = h * 6;
  const x  = c * (1 - Math.abs((hp % 2) - 1));
  const m  = v - c;
  let r = 0, g = 0, b = 0;
  if      (hp < 1) { r = c; g = x; b = 0; }
  else if (hp < 2) { r = x; g = c; b = 0; }
  else if (hp < 3) { r = 0; g = c; b = x; }
  else if (hp < 4) { r = 0; g = x; b = c; }
  else if (hp < 5) { r = x; g = 0; b = c; }
  else             { r = c; g = 0; b = x; }
  return [r + m, g + m, b + m];
}

interface Seed {
  x: number; y: number;
  vx: number; vy: number;
  r: number; g: number; b: number;
}

function makeSeed(index: number, total: number): Seed {
  const hue = index / total;
  const [r, g, b] = hsvToRgb(hue, 0.8, 1.0);
  return {
    x:  Math.random(),
    y:  Math.random(),
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r, g, b,
  };
}

function makeSeeds(count: number): Seed[] {
  return Array.from({ length: count }, (_, i) => makeSeed(i, count));
}

export const VoronoiPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const gpuRef = useRef<{
    device:        GPUDevice;
    canvasContext: GPUCanvasContext;
    pipeline:      GPURenderPipeline;
    uniformBuffer: GPUBuffer;
    seedsBuffer:   GPUBuffer;
    bindGroup:     GPUBindGroup;
    bgl:           GPUBindGroupLayout;
  } | null>(null);

  const rafRef    = useRef(0);
  const activeRef = useRef(true);

  const [fps, setFps]           = useState(0);
  const fpsFrames               = useRef(0);
  const fpsTime                 = useRef(performance.now());

  // Simulation state (refs for animation loop access)
  const seedsRef      = useRef<Seed[]>(makeSeeds(NUM_SEEDS));
  const pausedRef     = useRef(false);
  const numSeedsRef   = useRef(NUM_SEEDS);
  const colorModeRef  = useRef(0);
  const showEdgesRef  = useRef(false);
  const edgeWidthRef  = useRef(1.0);
  const speedRef      = useRef(1.0);
  const lastTimeRef   = useRef(performance.now());

  // React state (for UI rendering)
  const [numSeeds,  setNumSeeds]  = useState(NUM_SEEDS);
  const [colorMode, setColorMode] = useState(0);
  const [showEdges, setShowEdges] = useState(false);
  const [speed,     setSpeed]     = useState(1.0);
  const [paused,    setPaused]    = useState(false);

  // ─── GPU init ────────────────────────────────────────────────────────────────

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const module = device.createShaderModule({ code: voronoiCode });

    const uniformBuffer = device.createBuffer({
      size:  32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const seedsBuffer = device.createBuffer({
      size:  MAX_SEEDS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const bgl = device.createBindGroupLayout({
      entries: [
        {
          binding:    0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:     { type: 'uniform' },
        },
        {
          binding:    1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer:     { type: 'read-only-storage' },
        },
      ],
    });

    const bindGroup = device.createBindGroup({
      layout:  bgl,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: seedsBuffer   } },
      ],
    });

    const pipeline = device.createRenderPipeline({
      layout:   device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex:   { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = { device, canvasContext, pipeline, uniformBuffer, seedsBuffer, bindGroup, bgl };
  }, []);

  // ─── Render loop ─────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    const now = performance.now();
    const dt  = Math.min((now - lastTimeRef.current) * 0.001, 0.05); // seconds, capped
    lastTimeRef.current = now;

    const seeds  = seedsRef.current;
    const n      = numSeedsRef.current;
    const spd    = speedRef.current;

    // Update seed positions
    if (!pausedRef.current) {
      for (let i = 0; i < n; i++) {
        const s = seeds[i];
        s.x += s.vx * spd * dt;
        s.y += s.vy * spd * dt;
        if (s.x < 0) { s.x = 0;  s.vx = Math.abs(s.vx); }
        if (s.x > 1) { s.x = 1;  s.vx = -Math.abs(s.vx); }
        if (s.y < 0) { s.y = 0;  s.vy = Math.abs(s.vy); }
        if (s.y > 1) { s.y = 1;  s.vy = -Math.abs(s.vy); }
      }
    }

    // Write seeds buffer (MAX_SEEDS * 8 floats)
    const seedData = new Float32Array(MAX_SEEDS * 8);
    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      seedData[i * 8 + 0] = s.x;
      seedData[i * 8 + 1] = s.y;
      seedData[i * 8 + 2] = s.r;
      seedData[i * 8 + 3] = s.g;
      seedData[i * 8 + 4] = s.b;
      // [5,6,7] = 0 (padding, Float32Array defaults to 0)
    }
    gpu.device.queue.writeBuffer(gpu.seedsBuffer, 0, seedData);

    // Write uniform buffer
    const canvas = canvasRef.current!;
    const ub     = new ArrayBuffer(32);
    const u32    = new Uint32Array(ub);
    const f32    = new Float32Array(ub);
    u32[0] = canvas.width;
    u32[1] = canvas.height;
    u32[2] = n;
    u32[3] = colorModeRef.current;
    f32[4] = performance.now() * 0.001;
    u32[5] = showEdgesRef.current ? 1 : 0;
    f32[6] = edgeWidthRef.current;
    f32[7] = 0;
    gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, ub);

    // Render
    const encoder = gpu.device.createCommandEncoder();
    const pass    = encoder.beginRenderPass({
      colorAttachments: [{
        view:       gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1 },
        loadOp:     'clear',
        storeOp:    'store',
      }],
    });
    pass.setPipeline(gpu.pipeline);
    pass.setBindGroup(0, gpu.bindGroup);
    pass.draw(4);
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);

    // FPS counter
    fpsFrames.current++;
    if (now - fpsTime.current >= 500) {
      setFps(Math.round(fpsFrames.current * 1000 / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current   = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  // ─── Mount / unmount ─────────────────────────────────────────────────────────

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

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleColorMode = (i: number) => {
    setColorMode(i);
    colorModeRef.current = i;
  };

  const handleShowEdges = () => {
    const next = !showEdgesRef.current;
    setShowEdges(next);
    showEdgesRef.current = next;
  };

  const handleSeedCount = (count: number) => {
    // Re-init seeds for new count
    seedsRef.current   = makeSeeds(count);
    numSeedsRef.current = count;
    setNumSeeds(count);
  };

  const handleSpeed = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setSpeed(v);
    speedRef.current = v;
  };

  const handlePause = () => {
    const next = !pausedRef.current;
    setPaused(next);
    pausedRef.current = next;
  };

  const handleReset = () => {
    seedsRef.current = makeSeeds(numSeedsRef.current);
    setPaused(false);
    pausedRef.current = false;
  };

  useSimKeyboard({
    onPause: handlePause,
    onReset: handleReset,
  });

  // ─── Render ──────────────────────────────────────────────────────────────────

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
            <h1>Voronoi Diagram</h1>
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
          {/* Color Mode */}
          <div className="control-group">
            <label>Color Mode</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {COLOR_MODES.map((m, i) => (
                <button
                  key={m}
                  className={`preset-btn${colorMode === i ? ' active' : ''}`}
                  onClick={() => handleColorMode(i)}
                >
                  <span className="preset-label">{m}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Seed Count */}
          <div className="control-group">
            <label>Seeds</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {SEED_COUNTS.map(c => (
                <button
                  key={c}
                  className={`preset-btn${numSeeds === c ? ' active' : ''}`}
                  onClick={() => handleSeedCount(c)}
                >
                  <span className="preset-label">{c}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Show Edges */}
          <div className="control-group">
            <label>Edges</label>
            <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              <button
                className={`preset-btn${showEdges ? ' active' : ''}`}
                onClick={handleShowEdges}
              >
                <span className="preset-label">{showEdges ? 'On' : 'Off'}</span>
              </button>
            </div>
          </div>

          {/* Speed */}
          <div className="control-group">
            <label>Speed — {speed.toFixed(1)}x</label>
            <input
              type="range"
              min={0.5}
              max={3.0}
              step={0.1}
              value={speed}
              onChange={handleSpeed}
              style={{ width: '100%' }}
            />
          </div>

          {/* Actions */}
          <div className="control-group actions-row">
            <button className="action-btn primary" onClick={handlePause}>
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button className="action-btn" onClick={handleReset}>
              ↺ Reset
            </button>
            <ShareButton canvasRef={canvasRef} title="Voronoi Diagram" params={`seeds=${numSeeds}`} />
          </div>

          <div className="hints">
            <span>Space = pause · R = reset · Esc = back</span>
          </div>
        </aside>
      </div>

      <TutorialOverlay
        id="voronoi"
        steps={[
          { icon: '🔵', title: 'Voronoi Diagram', desc: 'Each pixel is colored by its nearest seed point, creating geometric regions in real-time.' },
          { icon: '🎨', title: 'Color Modes', desc: 'Cell shows solid regions, Distance shows a gradient, Smooth blends colors with contour lines.' },
          { icon: '✦', title: 'Seeds', desc: 'Change the number of seed points (8–64). More seeds = smaller, more complex cells.' },
          { icon: '⚡', title: 'Edges', desc: 'Toggle edge lines to highlight the Voronoi boundaries between cells.' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
