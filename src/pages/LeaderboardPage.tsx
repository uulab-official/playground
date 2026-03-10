import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BenchmarkResult } from '../stores/useSimulationStore';

function getScoreGrade(score: number): { grade: string; color: string } {
  if (score >= 10000) return { grade: 'S+', color: '#f59e0b' };
  if (score >= 7000) return { grade: 'S', color: '#eab308' };
  if (score >= 5000) return { grade: 'A', color: '#10b981' };
  if (score >= 3000) return { grade: 'B', color: '#3b82f6' };
  if (score >= 1500) return { grade: 'C', color: '#8b5cf6' };
  return { grade: 'D', color: '#ef4444' };
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const STORAGE_KEY = 'gpu-playground-leaderboard';

function loadLeaderboard(): BenchmarkResult[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BenchmarkResult[];
  } catch { return []; }
}

function saveToLeaderboard(result: BenchmarkResult) {
  const existing = loadLeaderboard();
  existing.push(result);
  existing.sort((a, b) => b.totalScore - a.totalScore);
  const top50 = existing.slice(0, 50);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(top50));
}

function clearLeaderboard() {
  localStorage.removeItem(STORAGE_KEY);
}

export { saveToLeaderboard };

export const LeaderboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<BenchmarkResult[]>([]);

  useEffect(() => {
    setEntries(loadLeaderboard());
  }, []);

  return (
    <div className="app-container dark">
      <div className="leaderboard-page">
        <button className="icon-btn back-btn" onClick={() => navigate('/')}>← Home</button>

        <div className="lb-header">
          <h1 className="gradient-text">Leaderboard</h1>
          <p className="lb-subtitle">Local benchmark rankings — run Stress Test to place your score!</p>
        </div>

        {entries.length === 0 ? (
          <div className="lb-empty">
            <p>No benchmark results yet.</p>
            <button className="cta-button" onClick={() => navigate('/benchmark')}>
              ⚡ Run Benchmark
            </button>
          </div>
        ) : (
          <>
            <div className="lb-table">
              <div className="lb-row lb-header-row">
                <span className="lb-rank">#</span>
                <span className="lb-grade">Grade</span>
                <span className="lb-score">Score</span>
                <span className="lb-gpu">GPU</span>
                <span className="lb-fps">Avg FPS</span>
                <span className="lb-particles">Particles</span>
                <span className="lb-date">Date</span>
              </div>
              {entries.map((e, i) => {
                const { grade, color } = getScoreGrade(e.totalScore);
                return (
                  <div key={i} className={`lb-row ${i < 3 ? 'lb-top' : ''}`}>
                    <span className="lb-rank">
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                    </span>
                    <span className="lb-grade" style={{ color }}>{grade}</span>
                    <span className="lb-score">{e.totalScore.toLocaleString()}</span>
                    <span className="lb-gpu">{e.gpuModel}</span>
                    <span className="lb-fps">{e.avgFps}</span>
                    <span className="lb-particles">{formatK(e.maxParticlesMaintained)}</span>
                    <span className="lb-date">{new Date(e.timestamp).toLocaleDateString()}</span>
                  </div>
                );
              })}
            </div>

            <div className="lb-actions">
              <button className="action-btn" onClick={() => navigate('/benchmark')}>
                ⚡ Run Again
              </button>
              <button className="action-btn" onClick={() => {
                if (confirm('Clear all leaderboard data?')) {
                  clearLeaderboard();
                  setEntries([]);
                }
              }}>
                🗑 Clear
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
