import { useEffect, useState } from 'react';
import { useSimulationStore } from './stores/useSimulationStore';
import { WebGPUCanvas } from './components/WebGPUCanvas';
import { checkWebGPUSupport } from './lib/webgpu';
import './index.css';

function App() {
  const {
    particleCount,
    fps,
    isPaused,
    togglePause,
    setParticleCount,
    settings,
    updateSettings
  } = useSimulationStore();

  const [supportChecked, setSupportChecked] = useState(false);

  useEffect(() => {
    async function check() {
      const isSupported = await checkWebGPUSupport();
      updateSettings({ useWebGPU: isSupported });
      setSupportChecked(true);
    }
    check();
  }, [updateSettings]);

  if (!supportChecked) {
    return <div className="loading">Checking WebGPU support...</div>;
  }

  return (
    <div className={`app-container ${settings.darkMode ? 'dark' : 'light'}`}>
      <main className="canvas-container">
        {settings.useWebGPU ? (
          <WebGPUCanvas />
        ) : (
          <div className="fallback-message">
            <h2>WebGPU NOT Supported</h2>
            <p>Your browser or device does not support WebGPU.</p>
            <p>WebGL2 Fallback will be implemented here.</p>
          </div>
        )}
      </main>

      {/* Overlay UI */}
      <div className="ui-overlay">
        <header className="ui-header">
          <h1>GPU Stress Test</h1>
          <div className="stats">
            <span className="fps">FPS: {fps}</span>
            <span className="particles">Particles: {particleCount.toLocaleString()}</span>
          </div>
        </header>

        <aside className="ui-controls">
          <div className="control-group">
            <label>Mode</label>
            <select disabled>
              <option>Particle Drop (MVP)</option>
              <option>Benchmark</option>
            </select>
          </div>

          <div className="control-group">
            <label>Particles Count</label>
            <input
              type="range"
              min="1000"
              max="200000"
              step="1000"
              value={particleCount}
              onChange={(e) => setParticleCount(Number(e.target.value))}
            />
            <div className="range-values">
              <span>1k</span>
              <span>200k</span>
            </div>
          </div>

          <div className="control-group actions">
            <button onClick={togglePause}>
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button onClick={() => updateSettings({ darkMode: !settings.darkMode })}>
              {settings.darkMode ? '☀️ Light' : '🌙 Dark'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
