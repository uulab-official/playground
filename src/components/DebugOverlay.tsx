import { useSimulationStore } from '../stores/useSimulationStore';

export const DebugOverlay: React.FC = () => {
  const {
    fps, frameTimes, particleCount, isPaused, timeScale,
    gravity, damping, brushSize, activePreset, materialType,
    mouse, settings, continuousSpawn, spawnRate,
  } = useSimulationStore();

  const avgFrameTime = frameTimes.length > 0
    ? (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length).toFixed(2)
    : '0';

  const minFrameTime = frameTimes.length > 0
    ? Math.min(...frameTimes).toFixed(2)
    : '0';

  const maxFrameTime = frameTimes.length > 0
    ? Math.max(...frameTimes).toFixed(2)
    : '0';

  return (
    <div className="debug-overlay">
      <div className="debug-title">Debug Info</div>
      <div className="debug-section">
        <div className="debug-row"><span>FPS</span><span className="fps-good">{fps}</span></div>
        <div className="debug-row"><span>Frame Time (avg)</span><span>{avgFrameTime}ms</span></div>
        <div className="debug-row"><span>Frame Time (min/max)</span><span>{minFrameTime}/{maxFrameTime}ms</span></div>
        <div className="debug-row"><span>Particles</span><span>{particleCount.toLocaleString()}</span></div>
        <div className="debug-row"><span>GPU Workgroups</span><span>{Math.ceil(particleCount / 256)}</span></div>
      </div>
      <div className="debug-section">
        <div className="debug-row"><span>Preset</span><span>{activePreset}</span></div>
        <div className="debug-row"><span>Material</span><span>{materialType}</span></div>
        <div className="debug-row"><span>Paused</span><span>{isPaused ? 'Yes' : 'No'}</span></div>
        <div className="debug-row"><span>Time Scale</span><span>{timeScale}x</span></div>
        <div className="debug-row"><span>Gravity</span><span>{gravity}</span></div>
        <div className="debug-row"><span>Damping</span><span>{damping}</span></div>
        <div className="debug-row"><span>Brush Size</span><span>{brushSize}</span></div>
      </div>
      <div className="debug-section">
        <div className="debug-row"><span>Mouse</span><span>({mouse.x.toFixed(2)}, {mouse.y.toFixed(2)})</span></div>
        <div className="debug-row"><span>Mouse L/R</span><span>{mouse.pressed ? 'L' : '-'} / {mouse.rightPressed ? 'R' : '-'}</span></div>
        <div className="debug-row"><span>Continuous Spawn</span><span>{continuousSpawn ? `${spawnRate}/s` : 'Off'}</span></div>
        <div className="debug-row"><span>Resolution</span><span>{(settings.resolutionScale * 100).toFixed(0)}%</span></div>
        <div className="debug-row"><span>DPR</span><span>{window.devicePixelRatio.toFixed(1)}</span></div>
      </div>
    </div>
  );
};
