import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkWebGPUSupport } from '../lib/webgpu';

type SupportStatus = 'checking' | 'supported' | 'unsupported';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [gpuStatus, setGpuStatus] = useState<SupportStatus>('checking');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    checkWebGPUSupport().then((ok) =>
      setGpuStatus(ok ? 'supported' : 'unsupported')
    );
  }, []);

  // Background particle animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let w = 0, h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const dots: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = [];
    for (let i = 0; i < 90; i++) {
      dots.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.5,
        a: Math.random() * 0.35 + 0.05,
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx; d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99, 102, 241, ${d.a})`;
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.03)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          if (dx * dx + dy * dy < 12000) {
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.stroke();
          }
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  const ok = gpuStatus === 'supported';

  const simModes = [
    {
      id: 'particle', title: 'Particle Drop', path: '/play',
      desc: '최대 50만 파티클 물리 시뮬레이션. GPU Compute로 실시간 충돌과 중력.',
      icon: '✦', gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
      ready: true, isNew: false,
    },
    {
      id: 'fractal', title: 'Fractal Explorer', path: '/fractal',
      desc: 'Mandelbrot & Julia Set. 무한 줌으로 프랙탈 세계를 탐험.',
      icon: '🔮', gradient: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
      ready: true, isNew: false,
    },
    {
      id: 'life', title: 'Game of Life', path: '/life',
      desc: "Conway's Game of Life. 512x512 셀 GPU 계산.",
      icon: '🧬', gradient: 'linear-gradient(135deg, #10b981, #06b6d4)',
      ready: true, isNew: false,
    },
    {
      id: 'boids', title: 'Boids Flock', path: '/boids',
      desc: '군집 시뮬레이션. 새떼의 분리/정렬/응집.',
      icon: '🐦', gradient: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
      ready: true, isNew: false,
    },
    {
      id: 'reaction', title: 'Reaction-Diffusion', path: '/reaction',
      desc: 'Gray-Scott 모델. 유기적 튜링 패턴이 실시간 생성.',
      icon: '🧫', gradient: 'linear-gradient(135deg, #14b8a6, #06b6d4)',
      ready: true, isNew: true,
    },
    {
      id: 'raymarch', title: 'Ray Marching', path: '/raymarch',
      desc: 'GPU 3D 렌더링. SDF 기반 메타볼/멩거 스폰지/지형.',
      icon: '🎨', gradient: 'linear-gradient(135deg, #f43f5e, #a855f7)',
      ready: true, isNew: true,
    },
    {
      id: 'sand', title: 'Falling Sand', path: '/sand',
      desc: '모래/물/불/돌/증기. 재료 상호작용 샌드박스.',
      icon: '🏖', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
      ready: true, isNew: true,
    },
    {
      id: 'audio', title: 'Audio Visualizer', path: '/audio',
      desc: '마이크/음악에 반응하는 GPU 파티클 비주얼. 원형 스펙트럼, 파티클 필드, 웨이브폼.',
      icon: '🎵', gradient: 'linear-gradient(135deg, #f43f5e, #ec4899)',
      ready: true, isNew: true,
    },
    {
      id: 'galaxy', title: 'N-Body Galaxy', path: '/galaxy',
      desc: '2만 개 별의 중력 시뮬레이션. 나선 은하, 충돌, 링 형성.',
      icon: '🌌', gradient: 'linear-gradient(135deg, #6366f1, #0ea5e9)',
      ready: true, isNew: true,
    },
    {
      id: 'wave', title: 'Wave Equation', path: '/wave',
      desc: '2D 파동 방정식. 터치로 물결을 만들고 간섭 패턴을 관찰.',
      icon: '💧', gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
      ready: true, isNew: true,
    },
    {
      id: 'fluid', title: 'Fluid Sim', path: '/fluid',
      desc: 'Navier-Stokes 유체 시뮬레이션. 드래그로 컬러풀한 유체를 만들어보세요.',
      icon: '🌊', gradient: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
      ready: true, isNew: true,
    },
  ];

  return (
    <div className="landing-page">
      <canvas ref={canvasRef} className="landing-bg" />

      <div className="landing-content">
        {/* Hero */}
        <header className="landing-hero">
          <h1 className="landing-title">
            GPU <span className="gradient-text">Playground</span>
          </h1>
          <p className="landing-subtitle">
            WebGPU 기반 초고성능 시뮬레이션 & 벤치마크 플랫폼
          </p>

          <div className="hero-features">
            <span className="hero-chip">500K+ Particles</span>
            <span className="hero-chip">Real-time GPU Compute</span>
            <span className="hero-chip">11 Simulations</span>
          </div>

          <div className={`gpu-status-bar status-${gpuStatus}`}>
            <span className="status-dot" />
            {gpuStatus === 'checking' && 'WebGPU 지원 확인 중...'}
            {gpuStatus === 'supported' && 'WebGPU Supported — 최고 성능으로 실행 가능'}
            {gpuStatus === 'unsupported' && 'WebGPU 미지원 — Chrome 113+ / Edge 113+ 필요'}
          </div>
        </header>

        {/* Category: Simulations */}
        <div className="landing-section">
          <h2 className="section-title">
            <span className="section-icon">🎮</span> Simulations
          </h2>
          <div className="mode-grid">
            {simModes.map(m => (
              <button
                key={m.id}
                className={`mode-card ${!m.ready ? 'coming-soon' : ''}`}
                onClick={() => m.ready && ok && navigate(m.path)}
                disabled={!m.ready || !ok}
              >
                <div className="mode-icon" style={{ background: m.gradient }}>{m.icon}</div>
                <div className="mode-info">
                  <h3>
                    {m.title}
                    {m.isNew && <span className="new-badge">NEW</span>}
                  </h3>
                  <p>{m.desc}</p>
                </div>
                {!m.ready && <span className="soon-badge">SOON</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Category: Benchmark & Leaderboard */}
        <div className="landing-section">
          <h2 className="section-title">
            <span className="section-icon">📊</span> Benchmark
          </h2>
          <div className="mode-grid benchmark-grid">
            <button
              className="mode-card benchmark-card"
              onClick={() => ok && navigate('/benchmark')}
              disabled={!ok}
            >
              <div className="mode-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}>⚡</div>
              <div className="mode-info">
                <h3>Stress Test</h3>
                <p>GPU 스트레스 테스트. 파티클을 극한까지 밀어 성능 점수 측정.</p>
              </div>
              <div className="benchmark-cta">
                <span>Start Test →</span>
              </div>
            </button>
            <button
              className="mode-card leaderboard-card"
              onClick={() => navigate('/leaderboard')}
            >
              <div className="mode-icon" style={{ background: 'linear-gradient(135deg, #eab308, #f59e0b)' }}>🏆</div>
              <div className="mode-info">
                <h3>Leaderboard</h3>
                <p>로컬 벤치마크 순위표. 내 GPU 성능을 비교.</p>
              </div>
            </button>
          </div>
        </div>

        {/* Ad placeholder / Sponsor area */}
        <div className="sponsor-area">
          <div className="sponsor-inner">
            <span className="sponsor-label">Sponsored</span>
            <p className="sponsor-placeholder">Your brand here — contact@gpu-playground.dev</p>
          </div>
        </div>

        {/* Quick Start */}
        {ok && (
          <button className="cta-button" onClick={() => navigate('/play')}>
            지금 바로 시작하기
          </button>
        )}

        <footer className="landing-footer">
          <p>Built with WebGPU + React + TypeScript</p>
          <p className="footer-links">
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
            <span>·</span>
            <a href="https://x.com" target="_blank" rel="noopener noreferrer">Twitter</a>
          </p>
        </footer>
      </div>
    </div>
  );
};
