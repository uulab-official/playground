import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BenchmarkResult } from '../stores/useSimulationStore';
import { getGlobalLeaderboard, isFirebaseConfigured } from '../lib/firebase';

/* ── Score helpers ────────────────────────────────────────── */

function getScoreGrade(score: number): { grade: string; color: string } {
  if (score >= 10000) return { grade: 'S+', color: '#f59e0b' };
  if (score >= 7000)  return { grade: 'S',  color: '#eab308' };
  if (score >= 5000)  return { grade: 'A',  color: '#10b981' };
  if (score >= 3000)  return { grade: 'B',  color: '#3b82f6' };
  if (score >= 1500)  return { grade: 'C',  color: '#8b5cf6' };
  return { grade: 'D', color: '#ef4444' };
}

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/* ── Local storage helpers ────────────────────────────────── */

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

/* ── Table ────────────────────────────────────────────────── */

interface TableProps {
  entries: BenchmarkResult[];
  showClearBtn?: boolean;
  onClear?: () => void;
}

function LeaderboardTable({ entries, showClearBtn, onClear }: TableProps) {
  const navigate = useNavigate();

  if (entries.length === 0) {
    return (
      <div className="lb-empty">
        <p>No benchmark results yet.</p>
        <button className="cta-button" onClick={() => navigate('/benchmark')}>
          ⚡ Run Benchmark
        </button>
      </div>
    );
  }

  return (
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
        {showClearBtn && onClear && (
          <button className="action-btn" onClick={() => {
            if (confirm('Clear all leaderboard data?')) onClear();
          }}>
            🗑 Clear
          </button>
        )}
      </div>
    </>
  );
}

/* ── Global Tab ───────────────────────────────────────────── */

function GlobalTab() {
  const [entries, setEntries] = useState<BenchmarkResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      setError('not-configured');
      return;
    }

    getGlobalLeaderboard(50)
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch(() => {
        setError('fetch-failed');
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="lb-empty">
        <div className="loading-spinner" />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          글로벌 리더보드 불러오는 중…
        </p>
      </div>
    );
  }

  if (error === 'not-configured') {
    return (
      <div className="lb-empty lb-firebase-notice">
        <span style={{ fontSize: '2rem' }}>🔧</span>
        <p className="lb-firebase-title">Firebase 설정 필요</p>
        <p className="lb-firebase-desc">
          글로벌 리더보드를 사용하려면{' '}
          <code>.env.local</code>에 Firebase 환경 변수를 설정하세요.
        </p>
        <pre className="lb-firebase-code">{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...`}</pre>
      </div>
    );
  }

  if (error === 'fetch-failed') {
    return (
      <div className="lb-empty">
        <span style={{ fontSize: '2rem' }}>⚠️</span>
        <p style={{ color: 'var(--danger)' }}>데이터를 불러오지 못했습니다.</p>
      </div>
    );
  }

  return <LeaderboardTable entries={entries} />;
}

/* ── Page ─────────────────────────────────────────────────── */

type Tab = 'local' | 'global';

export const LeaderboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('local');
  const [localEntries, setLocalEntries] = useState<BenchmarkResult[]>([]);

  useEffect(() => {
    setLocalEntries(loadLeaderboard());
  }, []);

  return (
    <div className="app-container dark">
      <div className="leaderboard-page">
        <button className="icon-btn back-btn" onClick={() => navigate('/')}>
          ← Home
        </button>

        <div className="lb-header">
          <h1 className="gradient-text">Leaderboard</h1>
          <p className="lb-subtitle">
            Benchmark rankings — run Stress Test to place your score!
          </p>
        </div>

        {/* Tab bar */}
        <div className="lb-tabs">
          <button
            className={`lb-tab ${activeTab === 'local' ? 'lb-tab-active' : ''}`}
            onClick={() => setActiveTab('local')}
          >
            🖥 내 기록
          </button>
          <button
            className={`lb-tab ${activeTab === 'global' ? 'lb-tab-active' : ''}`}
            onClick={() => setActiveTab('global')}
          >
            🌐 글로벌
          </button>
        </div>

        {/* Tab content */}
        {activeTab === 'local' ? (
          <LeaderboardTable
            entries={localEntries}
            showClearBtn
            onClear={() => {
              clearLeaderboard();
              setLocalEntries([]);
            }}
          />
        ) : (
          <GlobalTab />
        )}
      </div>
    </div>
  );
};
