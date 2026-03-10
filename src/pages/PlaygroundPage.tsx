import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSimulationStore, type PresetType, type MaterialType } from '../stores/useSimulationStore';
import { WebGPUCanvas } from '../components/WebGPUCanvas';
import { FPSGraph } from '../components/FPSGraph';
import { DebugOverlay } from '../components/DebugOverlay';
import { checkWebGPUSupport } from '../lib/webgpu';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const PRESETS: { id: PresetType; label: string; icon: string }[] = [
  { id: 'default', label: 'Scatter', icon: '✦' },
  { id: 'explosion', label: 'Explosion', icon: '💥' },
  { id: 'vortex', label: 'Vortex', icon: '🌀' },
  { id: 'rain', label: 'Rain', icon: '🌧' },
  { id: 'fountain', label: 'Fountain', icon: '⛲' },
];

const MATERIALS: { id: MaterialType; label: string; color: string }[] = [
  { id: 'normal', label: 'Normal', color: '#6366f1' },
  { id: 'fire', label: 'Fire', color: '#ef4444' },
  { id: 'water', label: 'Water', color: '#3b82f6' },
  { id: 'spark', label: 'Spark', color: '#f59e0b' },
];

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export const PlaygroundPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    particleCount, fps, isPaused, timeScale,
    gravity, damping, brushSize, activePreset, materialType,
    continuousSpawn, spawnRate,
    settings,
    togglePause, setParticleCount, updateSettings,
    setBrushSize, setGravity, setDamping,
    setPreset, requestReset, setTimeScale,
    setMaterialType, setContinuousSpawn, setSpawnRate,
  } = useSimulationStore();

  const [supportChecked, setSupportChecked] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(true);
  const [toolbarOpen, setToolbarOpen] = useState(true);

  // Keep canvasRef in sync with the WebGPUCanvas-managed canvas element
  useEffect(() => {
    const el = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (el) (canvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = el;
  });

  useEffect(() => {
    checkWebGPUSupport().then((ok) => {
      updateSettings({ useWebGPU: ok });
      setSupportChecked(true);
      if (!ok) navigate('/');
    });
  }, [updateSettings, navigate]);

  const handleScreenshot = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `gpu-playground-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  const handleCopySeed = useCallback(() => {
    const seed = JSON.stringify({
      preset: activePreset,
      particles: particleCount,
      gravity, damping, timeScale, material: materialType,
    });
    navigator.clipboard.writeText(btoa(seed)).then(() => {
      alert('Seed copied to clipboard!');
    });
  }, [activePreset, particleCount, gravity, damping, timeScale, materialType]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'KeyR') requestReset();
    if (e.code === 'KeyS' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleScreenshot(); }
    if (e.code === 'KeyH') setControlsOpen(prev => !prev);
    if (e.code === 'KeyT') setToolbarOpen(prev => !prev);
    if (e.code === 'KeyD') updateSettings({ showDebugOverlay: !settings.showDebugOverlay });
  }, [togglePause, requestReset, handleScreenshot, settings.showDebugOverlay, updateSettings]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useSimKeyboard({
    onPause: () => togglePause(),
    onReset: () => requestReset(),
    onScreenshot: () => handleScreenshot(),
  });

  if (!supportChecked) {
    return (
      <div className="loading">
        <div className="loading-spinner" />
        <p>Initializing WebGPU...</p>
      </div>
    );
  }

  return (
    <div className={`app-container ${settings.darkMode ? 'dark' : 'light'}`}>
      <main className="canvas-container">
        <WebGPUCanvas />
      </main>

      {/* Debug Overlay */}
      {settings.showDebugOverlay && <DebugOverlay />}

      <div className="ui-overlay">
        {/* Top bar */}
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')} title="Home">
              ←
            </button>
            <h1>GPU Playground</h1>
            <span className="badge">{activePreset}</span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>
                {fps} FPS
              </span>
              <span className="divider">|</span>
              <span className="particles">{formatCount(particleCount)}</span>
            </div>
            <button className="icon-btn" onClick={() => setControlsOpen(!controlsOpen)} title="Toggle controls (H)">
              {controlsOpen ? '✕' : '☰'}
            </button>
          </div>
        </header>

        {/* Left toolbar */}
        {toolbarOpen && (
          <div className="toolbar-left">
            <div className="toolbar-section">
              <span className="toolbar-title">Material</span>
              {MATERIALS.map((m) => (
                <button
                  key={m.id}
                  className={`toolbar-btn ${materialType === m.id ? 'active' : ''}`}
                  onClick={() => setMaterialType(m.id)}
                  title={m.label}
                  style={{ '--mat-color': m.color } as React.CSSProperties}
                >
                  <span className="mat-dot" />
                  <span className="toolbar-label">{m.label}</span>
                </button>
              ))}
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-section">
              <span className="toolbar-title">Tools</span>
              <button
                className={`toolbar-btn ${continuousSpawn ? 'active' : ''}`}
                onClick={() => setContinuousSpawn(!continuousSpawn)}
                title="Continuous Spawn"
              >
                <span className="toolbar-icon">+</span>
                <span className="toolbar-label">Spawn</span>
              </button>
              <button className="toolbar-btn" onClick={requestReset} title="Reset (R)">
                <span className="toolbar-icon">↻</span>
                <span className="toolbar-label">Reset</span>
              </button>
              <button className="toolbar-btn" onClick={handleScreenshot} title="Screenshot">
                <span className="toolbar-icon">📷</span>
                <span className="toolbar-label">Capture</span>
              </button>
              <ShareButton canvasRef={canvasRef} title="Particle Drop" />
              <button className="toolbar-btn" onClick={handleCopySeed} title="Copy Seed">
                <span className="toolbar-icon">🔗</span>
                <span className="toolbar-label">Seed</span>
              </button>
            </div>

            <div className="toolbar-divider" />

            <button
              className={`toolbar-btn ${settings.showDebugOverlay ? 'active' : ''}`}
              onClick={() => updateSettings({ showDebugOverlay: !settings.showDebugOverlay })}
              title="Debug Overlay (D)"
            >
              <span className="toolbar-icon">🐛</span>
              <span className="toolbar-label">Debug</span>
            </button>
          </div>
        )}

        {/* Right panel */}
        {controlsOpen && (
          <aside className="ui-controls">
            {/* Presets */}
            <div className="control-group">
              <label>Preset</label>
              <div className="preset-grid">
                {PRESETS.map((p) => (
                  <button
                    key={p.id}
                    className={`preset-btn ${activePreset === p.id ? 'active' : ''}`}
                    onClick={() => setPreset(p.id)}
                  >
                    <span className="preset-icon">{p.icon}</span>
                    <span className="preset-label">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Particle count */}
            <div className="control-group">
              <label>Particles <span className="value">{formatCount(particleCount)}</span></label>
              <input
                type="range" min="1000" max="500000" step="1000"
                value={particleCount}
                onChange={(e) => setParticleCount(Number(e.target.value))}
              />
              <div className="range-values"><span>1k</span><span>500k</span></div>
            </div>

            {/* Continuous spawn rate */}
            {continuousSpawn && (
              <div className="control-group">
                <label>Spawn Rate <span className="value">{formatCount(spawnRate)}/s</span></label>
                <input
                  type="range" min="100" max="50000" step="100"
                  value={spawnRate}
                  onChange={(e) => setSpawnRate(Number(e.target.value))}
                />
              </div>
            )}

            {/* Physics */}
            <div className="control-group">
              <label>Gravity <span className="value">{gravity.toFixed(2)}</span></label>
              <input
                type="range" min="0" max="5" step="0.05"
                value={gravity} onChange={(e) => setGravity(Number(e.target.value))}
              />
            </div>
            <div className="control-group">
              <label>Damping <span className="value">{damping.toFixed(2)}</span></label>
              <input
                type="range" min="0" max="1" step="0.01"
                value={damping} onChange={(e) => setDamping(Number(e.target.value))}
              />
            </div>
            <div className="control-group">
              <label>Brush Size <span className="value">{brushSize.toFixed(2)}</span></label>
              <input
                type="range" min="0.02" max="0.5" step="0.01"
                value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}
              />
            </div>
            <div className="control-group">
              <label>Speed <span className="value">{timeScale.toFixed(1)}x</span></label>
              <input
                type="range" min="0.1" max="3" step="0.1"
                value={timeScale} onChange={(e) => setTimeScale(Number(e.target.value))}
              />
            </div>

            {/* Resolution Scale */}
            <div className="control-group">
              <label>Resolution <span className="value">{(settings.resolutionScale * 100).toFixed(0)}%</span></label>
              <input
                type="range" min="0.25" max="1" step="0.05"
                value={settings.resolutionScale}
                onChange={(e) => updateSettings({ resolutionScale: Number(e.target.value) })}
              />
            </div>

            {/* FPS Graph */}
            <div className="control-group">
              <label>Performance</label>
              <FPSGraph />
            </div>

            {/* Actions */}
            <div className="control-group actions-row">
              <button className="action-btn primary" onClick={togglePause}>
                {isPaused ? '▶ Play' : '⏸ Pause'}
              </button>
              <button className="action-btn" onClick={() => updateSettings({ darkMode: !settings.darkMode })}>
                {settings.darkMode ? '☀' : '🌙'}
              </button>
            </div>

            {/* Hints */}
            <div className="hints">
              <span>Left click: attract · Right click: repel</span>
              <span>Space: pause · R: reset · H: panel · T: toolbar · D: debug</span>
            </div>
          </aside>
        )}
      </div>
      <TutorialOverlay
        id="particle"
        steps={[
          { icon: '🖱️', title: '드래그', desc: '마우스 드래그로 파티클에 힘 적용' },
          { icon: '✦', title: '50만 파티클', desc: '슬라이더로 파티클 수 조절' },
          { icon: '🎮', title: '프리셋', desc: '폭발/소용돌이/분수 등 프리셋 선택' },
          { icon: '⌨️', title: '단축키', desc: 'Space=일시정지, R=초기화, Esc=홈' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
