import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSimulationStore, type BenchmarkResult, type SpawnMode } from '../stores/useSimulationStore';
import { WebGPUCanvas } from '../components/WebGPUCanvas';
import { checkWebGPUSupport, getGPUInfo } from '../lib/webgpu';
import { FPSGraph } from '../components/FPSGraph';

type BenchmarkPhase = 'config' | 'running' | 'done';
type BenchmarkDifficulty = 'low' | 'medium' | 'high' | 'extreme';

const DIFFICULTY_CONFIGS: Record<BenchmarkDifficulty, {
  startCount: number;
  maxCount: number;
  spawnPerWave: number;
  duration: number;
  label: string;
}> = {
  low: { startCount: 1000, maxCount: 100000, spawnPerWave: 2000, duration: 30, label: 'Low (100k)' },
  medium: { startCount: 5000, maxCount: 250000, spawnPerWave: 5000, duration: 45, label: 'Medium (250k)' },
  high: { startCount: 10000, maxCount: 500000, spawnPerWave: 10000, duration: 60, label: 'High (500k)' },
  extreme: { startCount: 50000, maxCount: 500000, spawnPerWave: 25000, duration: 60, label: 'Extreme' },
};

const SPAWN_MODES: { id: SpawnMode; label: string; desc: string }[] = [
  { id: 'wave', label: 'Wave', desc: '일정 간격으로 파도처럼 입자 추가' },
  { id: 'burst', label: 'Burst', desc: '짧은 간격으로 대량 투입' },
  { id: 'stream', label: 'Stream', desc: '지속적으로 끊임없이 생성' },
];

export const BenchmarkPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    fps,
    setParticleCount, setBenchmarkResult, setBenchmarkRunning,
    updateSettings, setGravity, setDamping, setPreset,
    setPerformanceMetrics,
  } = useSimulationStore();

  const [phase, setPhase] = useState<BenchmarkPhase>('config');
  const [difficulty, setDifficulty] = useState<BenchmarkDifficulty>('medium');
  const [spawnMode, setSpawnMode] = useState<SpawnMode>('wave');
  const [elapsed, setElapsed] = useState(0);
  const [currentWaveCount, setCurrentWaveCount] = useState(0);
  const [supportChecked, setSupportChecked] = useState(false);

  const fpsHistoryRef = useRef<number[]>([]);
  const particleHistoryRef = useRef<number[]>([]);
  const benchStartRef = useRef(0);
  const intervalRef = useRef(0);
  const gpuModelRef = useRef('WebGPU Device');

  useEffect(() => {
    checkWebGPUSupport().then(async (ok) => {
      updateSettings({ useWebGPU: ok });
      setSupportChecked(true);
      if (!ok) navigate('/');
      // try to get GPU info
      if (ok && navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (adapter) gpuModelRef.current = getGPUInfo(adapter);
      }
    });
  }, [updateSettings, navigate]);

  const startBenchmark = useCallback(() => {
    const config = DIFFICULTY_CONFIGS[difficulty];
    setParticleCount(config.startCount);
    setGravity(0.98);
    setDamping(0.8);
    setPreset('default');
    setBenchmarkRunning(true);
    setPhase('running');
    setElapsed(0);

    setCurrentWaveCount(config.startCount);
    fpsHistoryRef.current = [];
    particleHistoryRef.current = [];
    benchStartRef.current = performance.now();
  }, [difficulty, setParticleCount, setGravity, setDamping, setPreset, setBenchmarkRunning]);

  // Benchmark loop
  useEffect(() => {
    if (phase !== 'running') return;

    const config = DIFFICULTY_CONFIGS[difficulty];
    let count = config.startCount;

    intervalRef.current = window.setInterval(() => {
      const now = performance.now();
      const secs = (now - benchStartRef.current) / 1000;
      setElapsed(Math.floor(secs));

      // Record metrics
      const currentFps = useSimulationStore.getState().fps;
      fpsHistoryRef.current.push(currentFps);
      particleHistoryRef.current.push(count);

      // Check completion
      if (secs >= config.duration || count >= config.maxCount) {
        finishBenchmark();
        return;
      }

      // Auto-stop if FPS drops below 10 for extended period
      const recentFps = fpsHistoryRef.current.slice(-10);
      if (recentFps.length >= 10 && recentFps.every(f => f < 10)) {
        finishBenchmark();
        return;
      }

      // Spawn logic based on mode
      let addCount = 0;
      switch (spawnMode) {
        case 'wave':
          // Every 3 seconds, add a wave
          if (Math.floor(secs) % 3 === 0 && Math.floor(secs) !== Math.floor(secs - 0.5)) {
            addCount = config.spawnPerWave;
          }
          break;
        case 'burst':
          // Every 5 seconds, add a big burst
          if (Math.floor(secs) % 5 === 0 && Math.floor(secs) !== Math.floor(secs - 0.5)) {
            addCount = config.spawnPerWave * 3;
          }
          break;
        case 'stream':
          // Continuous: add particles every tick
          addCount = Math.floor(config.spawnPerWave / 6); // ~every 500ms
          break;
      }

      if (addCount > 0) {
        count = Math.min(count + addCount, config.maxCount);
        setCurrentWaveCount(count);
        setParticleCount(count);

      }
    }, 500);

    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, difficulty, spawnMode]);

  const finishBenchmark = useCallback(() => {
    clearInterval(intervalRef.current);
    setBenchmarkRunning(false);
    setPhase('done');

    const fpsHist = fpsHistoryRef.current;
    const sorted = [...fpsHist].sort((a, b) => a - b);
    const avgFps = fpsHist.reduce((a, b) => a + b, 0) / fpsHist.length;
    const minFps = sorted[0] || 0;
    const p1Low = sorted[Math.floor(sorted.length * 0.01)] || minFps;
    const maxP = Math.max(...particleHistoryRef.current);

    // Score calculation from IA:
    // Base = avgFps * (maxParticles / 1000)
    // Stability = 1 - ((avgFps - p1Low) / avgFps), clamped [0.5, 1.0]
    // Total = Base * Stability
    const stability = Math.max(0.5, Math.min(1.0, 1 - ((avgFps - p1Low) / Math.max(avgFps, 1))));
    const totalScore = Math.round(avgFps * (maxP / 1000) * stability);

    const result: BenchmarkResult = {
      gpuModel: gpuModelRef.current,
      browserVersion: navigator.userAgent.match(/Chrome\/[\d.]+|Firefox\/[\d.]+|Safari\/[\d.]+/)?.[0] || navigator.userAgent,
      totalScore,
      avgFps: Math.round(avgFps),
      minFps: Math.round(minFps),
      percentile1LowFps: Math.round(p1Low),
      maxParticlesMaintained: maxP,
      durationSeconds: Math.floor((performance.now() - benchStartRef.current) / 1000),
      timestamp: Date.now(),
      fpsHistory: fpsHist,
      particleHistory: particleHistoryRef.current,
    };

    setBenchmarkResult(result);
    // Clear metrics for clean state
    setPerformanceMetrics(0, 0);
  }, [setBenchmarkResult, setBenchmarkRunning, setPerformanceMetrics]);

  if (!supportChecked) {
    return <div className="loading"><div className="loading-spinner" /><p>Initializing...</p></div>;
  }

  // Config screen
  if (phase === 'config') {
    return (
      <div className="app-container dark">
        <div className="benchmark-config">
          <button className="icon-btn back-btn" onClick={() => navigate('/')}>← Back</button>
          <h1 className="gradient-text">Stress Test</h1>
          <p className="bench-desc">
            Aquarium 스타일 GPU 벤치마크.<br />
            파티클이 자동으로 생성되며 GPU 한계를 테스트합니다.
          </p>

          <div className="config-section">
            <h3>Difficulty</h3>
            <div className="config-grid">
              {(Object.entries(DIFFICULTY_CONFIGS) as [BenchmarkDifficulty, typeof DIFFICULTY_CONFIGS.low][]).map(([key, cfg]) => (
                <button
                  key={key}
                  className={`config-card ${difficulty === key ? 'active' : ''}`}
                  onClick={() => setDifficulty(key)}
                >
                  <span className="config-label">{cfg.label}</span>
                  <span className="config-detail">{cfg.duration}s · max {formatK(cfg.maxCount)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="config-section">
            <h3>Spawn Mode</h3>
            <div className="config-grid">
              {SPAWN_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`config-card ${spawnMode === m.id ? 'active' : ''}`}
                  onClick={() => setSpawnMode(m.id)}
                >
                  <span className="config-label">{m.label}</span>
                  <span className="config-detail">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <button className="cta-button" onClick={startBenchmark}>
            ⚡ Start Benchmark
          </button>
        </div>
      </div>
    );
  }

  // Running screen — minimal HUD
  if (phase === 'running') {
    const config = DIFFICULTY_CONFIGS[difficulty];
    const progress = Math.min(elapsed / config.duration, 1);

    return (
      <div className="app-container dark">
        <main className="canvas-container">
          <WebGPUCanvas />
        </main>

        <div className="benchmark-hud">
          <div className="hud-top">
            <div className="hud-stat">
              <span className="hud-label">TIME</span>
              <span className="hud-value">{elapsed}s / {config.duration}s</span>
            </div>
            <div className="hud-stat">
              <span className="hud-label">PARTICLES</span>
              <span className="hud-value particles">{formatK(currentWaveCount)}</span>
            </div>
            <div className="hud-stat">
              <span className="hud-label">FPS</span>
              <span className={`hud-value ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps}</span>
            </div>
            <button className="hud-stop" onClick={finishBenchmark}>Stop</button>
          </div>

          <div className="hud-progress">
            <div className="hud-progress-bar" style={{ width: `${progress * 100}%` }} />
          </div>

          <div className="hud-graph">
            <FPSGraph />
          </div>
        </div>
      </div>
    );
  }

  // Done → navigate to result
  if (phase === 'done') {
    navigate('/result');
    return null;
  }

  return null;
};

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}
