import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSimulationStore } from '../stores/useSimulationStore';
import { saveToLeaderboard } from './LeaderboardPage';

function formatK(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function getScoreGrade(score: number): { grade: string; color: string } {
  if (score >= 10000) return { grade: 'S+', color: '#f59e0b' };
  if (score >= 7000) return { grade: 'S', color: '#eab308' };
  if (score >= 5000) return { grade: 'A', color: '#10b981' };
  if (score >= 3000) return { grade: 'B', color: '#3b82f6' };
  if (score >= 1500) return { grade: 'C', color: '#8b5cf6' };
  return { grade: 'D', color: '#ef4444' };
}

export const ResultPage: React.FC = () => {
  const navigate = useNavigate();
  const result = useSimulationStore((s) => s.benchmarkResult);
  const graphRef = useRef<HTMLCanvasElement>(null);

  // Save to leaderboard on mount
  useEffect(() => {
    if (result) saveToLeaderboard(result);
  }, [result]);

  useEffect(() => {
    if (!result) {
      navigate('/benchmark');
      return;
    }

    // Draw FPS history graph
    const canvas = graphRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    for (const target of [30, 60, 120]) {
      const y = h - (target / 144) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.font = '10px Outfit, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${target}`, 4, y - 2);
    }

    const { fpsHistory, particleHistory } = result;

    // Draw particle count area (secondary)
    if (particleHistory.length > 1) {
      const maxP = Math.max(...particleHistory);
      ctx.beginPath();
      const step = w / (particleHistory.length - 1);
      for (let i = 0; i < particleHistory.length; i++) {
        const x = i * step;
        const y = h - (particleHistory[i] / maxP) * h * 0.8;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.fill();
    }

    // Draw FPS line
    if (fpsHistory.length > 1) {
      const gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, '#ef4444');
      gradient.addColorStop(0.3, '#f59e0b');
      gradient.addColorStop(0.5, '#10b981');
      gradient.addColorStop(1, '#6366f1');

      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const step = w / (fpsHistory.length - 1);
      for (let i = 0; i < fpsHistory.length; i++) {
        const x = i * step;
        const y = h - (Math.min(fpsHistory[i], 144) / 144) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('FPS + Particle Count over time', w - 4, 14);
  }, [result, navigate]);

  const downloadResultCard = useCallback(() => {
    if (!result) return;

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 420;
    const ctx = canvas.getContext('2d')!;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 800, 420);
    bg.addColorStop(0, '#0f0f1a');
    bg.addColorStop(1, '#1a1a2e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 420);

    // Border glow
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 784, 404);

    // Title
    ctx.font = 'bold 28px Outfit, sans-serif';
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'left';
    ctx.fillText('GPU Playground — Benchmark Result', 32, 50);

    // Score
    const { grade, color } = getScoreGrade(result.totalScore);
    ctx.font = 'bold 72px Outfit, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(grade, 680, 140);

    ctx.font = 'bold 36px Outfit, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(`Score: ${result.totalScore.toLocaleString()}`, 32, 120);

    // Stats
    const stats = [
      ['GPU', result.gpuModel],
      ['Browser', result.browserVersion],
      ['Avg FPS', String(result.avgFps)],
      ['Min FPS', String(result.minFps)],
      ['1% Low', String(result.percentile1LowFps)],
      ['Max Particles', formatK(result.maxParticlesMaintained)],
      ['Duration', `${result.durationSeconds}s`],
    ];

    ctx.font = '16px Outfit, sans-serif';
    let y = 170;
    for (const [label, value] of stats) {
      ctx.fillStyle = '#8b92a5';
      ctx.textAlign = 'left';
      ctx.fillText(label, 32, y);
      ctx.fillStyle = '#f0f2f5';
      ctx.textAlign = 'left';
      ctx.fillText(String(value), 200, y);
      y += 30;
    }

    // Watermark
    ctx.font = '12px Outfit, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.textAlign = 'right';
    ctx.fillText(`gpu-playground.dev · ${new Date(result.timestamp).toLocaleDateString()}`, 768, 400);

    const link = document.createElement('a');
    link.download = `benchmark-result-${result.totalScore}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [result]);

  if (!result) return null;

  const { grade, color } = getScoreGrade(result.totalScore);

  return (
    <div className="app-container dark">
      <div className="result-page">
        <button className="icon-btn back-btn" onClick={() => navigate('/')}>← Home</button>

        <div className="result-header">
          <h1 className="gradient-text">Benchmark Result</h1>
          <div className="result-score" style={{ borderColor: color }}>
            <span className="score-grade" style={{ color }}>{grade}</span>
            <span className="score-number">{result.totalScore.toLocaleString()}</span>
            <span className="score-label">Total Score</span>
          </div>
        </div>

        <div className="result-stats-grid">
          <div className="result-stat">
            <span className="stat-label">GPU</span>
            <span className="stat-value">{result.gpuModel}</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">Browser</span>
            <span className="stat-value">{result.browserVersion}</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">Avg FPS</span>
            <span className="stat-value fps-good">{result.avgFps}</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">Min FPS</span>
            <span className="stat-value fps-low">{result.minFps}</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">1% Low FPS</span>
            <span className="stat-value fps-mid">{result.percentile1LowFps}</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">Max Particles</span>
            <span className="stat-value particles">{formatK(result.maxParticlesMaintained)}</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">Duration</span>
            <span className="stat-value">{result.durationSeconds}s</span>
          </div>
          <div className="result-stat">
            <span className="stat-label">Stability</span>
            <span className="stat-value">
              {(Math.max(0.5, Math.min(1.0, 1 - ((result.avgFps - result.percentile1LowFps) / Math.max(result.avgFps, 1)))) * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* FPS History Graph */}
        <div className="result-graph">
          <h3>Performance Over Time</h3>
          <canvas ref={graphRef} style={{ width: '100%', height: '180px', borderRadius: '12px' }} />
        </div>

        {/* Actions */}
        <div className="result-actions">
          <button className="cta-button" onClick={downloadResultCard}>
            📷 Download Result Card
          </button>
          <button className="action-btn" onClick={() => navigate('/benchmark')}>
            ↻ Run Again
          </button>
          <button className="action-btn" onClick={() => {
            const text = `GPU Playground Benchmark: Score ${result.totalScore} (${grade}) | Avg ${result.avgFps} FPS | ${formatK(result.maxParticlesMaintained)} particles | ${result.gpuModel}`;
            if (navigator.share) {
              navigator.share({ title: 'GPU Playground Benchmark', text }).catch(() => {});
            } else {
              navigator.clipboard.writeText(text);
              alert('Result copied to clipboard!');
            }
          }}>
            📋 Share Result
          </button>
        </div>
      </div>
    </div>
  );
};
