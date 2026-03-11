import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { checkWebGPUSupport } from '../lib/webgpu';

type SupportStatus = 'checking' | 'supported' | 'unsupported';
type Category = 'particles' | 'cellular' | 'fluid' | 'visual';
type FilterTab = 'all' | Category;

interface SimMode {
  id: string;
  title: string;
  path: string;
  desc: string;
  icon: string;
  gradient: string;
  ready: boolean;
  isNew: boolean;
  category: Category;
  tags: string[];
}

const CATEGORIES: { id: FilterTab; label: string; icon: string }[] = [
  { id: 'all',       label: 'All',      icon: '⬡' },
  { id: 'particles', label: 'Particles', icon: '✦' },
  { id: 'cellular',  label: 'Cellular',  icon: '🔬' },
  { id: 'fluid',     label: 'Fluid',     icon: '💧' },
  { id: 'visual',    label: 'Visual',    icon: '🎨' },
];

const SIM_MODES: SimMode[] = [
  {
    id: 'particle', title: 'Particle Drop', path: '/play',
    desc: '최대 50만 파티클 물리 시뮬레이션. GPU Compute로 실시간 충돌과 중력.',
    icon: '✦', gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    ready: true, isNew: false, category: 'particles',
    tags: ['500K particles', 'GPU Compute'],
  },
  {
    id: 'boids', title: 'Boids Flock', path: '/boids',
    desc: '군집 시뮬레이션. 새떼의 분리/정렬/응집 행동.',
    icon: '🐦', gradient: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
    ready: true, isNew: false, category: 'particles',
    tags: ['flocking', 'spatial hash'],
  },
  {
    id: 'attractor', title: 'Strange Attractors', path: '/attractor',
    desc: '30만 파티클로 카오스 역학계 실시간 추적. 로렌즈/토마스/할보르센.',
    icon: '🌀', gradient: 'linear-gradient(135deg, #0891b2, #7c3aed)',
    ready: true, isNew: true, category: 'particles',
    tags: ['300K particles', 'chaos theory'],
  },
  {
    id: 'galaxy', title: 'N-Body Galaxy', path: '/galaxy',
    desc: '2만 개 별의 중력 시뮬레이션. 나선 은하, 충돌, 링 형성.',
    icon: '🌌', gradient: 'linear-gradient(135deg, #6366f1, #0ea5e9)',
    ready: true, isNew: true, category: 'particles',
    tags: ['20K stars', 'gravity'],
  },
  {
    id: 'particle-life', title: 'Particle Life', path: '/particle-life',
    desc: '6종 1만 파티클의 종별 인력/반발. 카오스/하모니/포식자/대칭 프리셋.',
    icon: '🧬', gradient: 'linear-gradient(135deg, #f43f5e, #f97316)',
    ready: true, isNew: true, category: 'particles',
    tags: ['10K particles', 'force matrix', 'O(N²)'],
  },
  {
    id: 'nbody', title: 'N-Body Gravity', path: '/nbody',
    desc: '4096개 천체 전체쌍 중력 계산. 타일 공유메모리로 O(N²) GPU 최적화.',
    icon: '⭐', gradient: 'linear-gradient(135deg, #1e1b4b, #4f46e5)',
    ready: true, isNew: true, category: 'particles',
    tags: ['4096 bodies', 'O(N²)', 'shared memory'],
  },
  {
    id: 'life', title: 'Game of Life', path: '/life',
    desc: "Conway's Game of Life. 512×512 셀 GPU 병렬 계산.",
    icon: '🟢', gradient: 'linear-gradient(135deg, #10b981, #06b6d4)',
    ready: true, isNew: false, category: 'cellular',
    tags: ['512×512', 'cellular automata'],
  },
  {
    id: 'reaction', title: 'Reaction-Diffusion', path: '/reaction',
    desc: 'Gray-Scott 모델. 유기적 튜링 패턴이 실시간 생성.',
    icon: '🧫', gradient: 'linear-gradient(135deg, #14b8a6, #06b6d4)',
    ready: true, isNew: true, category: 'cellular',
    tags: ['512×512', 'Gray-Scott'],
  },
  {
    id: 'sand', title: 'Falling Sand', path: '/sand',
    desc: '모래/물/불/돌/증기. 재료 상호작용 셀룰러 샌드박스.',
    icon: '🏖', gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    ready: true, isNew: true, category: 'cellular',
    tags: ['5 materials', 'sandbox'],
  },
  {
    id: 'fire', title: 'Fire Simulation', path: '/fire',
    desc: '셀룰러 오토마타 화재 시뮬레이션. 냉각·난류 조절, 3가지 색상 팔레트.',
    icon: '🔥', gradient: 'linear-gradient(135deg, #ef4444, #f97316)',
    ready: true, isNew: true, category: 'cellular',
    tags: ['512×512', 'ping-pong'],
  },
  {
    id: 'physarum', title: 'Physarum', path: '/physarum',
    desc: '20만 에이전트의 점균류 네트워크. 3방향 센서 주행, 확산·잔류.',
    icon: '🍄', gradient: 'linear-gradient(135deg, #4ade80, #16a34a)',
    ready: true, isNew: true, category: 'cellular',
    tags: ['200K agents', 'atomic trail'],
  },
  {
    id: 'lenia', title: 'Lenia', path: '/lenia',
    desc: '연속 셀룰러 오토마타 — 링 커널 컨볼루션으로 살아있는 패턴.',
    icon: '🧬', gradient: 'linear-gradient(135deg, #065f46, #34d399)',
    ready: true, isNew: true, category: 'cellular',
    tags: ['256×256', 'kernel convolution'],
  },
  {
    id: 'fluid', title: 'Fluid Sim', path: '/fluid',
    desc: 'Navier-Stokes 유체. 드래그로 컬러풀한 잉크를 퍼뜨려 보세요.',
    icon: '🌊', gradient: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    ready: true, isNew: true, category: 'fluid',
    tags: ['Navier-Stokes', 'advection'],
  },
  {
    id: 'wave', title: 'Wave Equation', path: '/wave',
    desc: '2D 파동 방정식. 터치로 물결을 만들고 간섭·반사 패턴 관찰.',
    icon: '💧', gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
    ready: true, isNew: true, category: 'fluid',
    tags: ['triple buffer', 'damping'],
  },
  {
    id: 'fractal', title: 'Fractal Explorer', path: '/fractal',
    desc: 'Mandelbrot & Julia Set. 무한 줌으로 프랙탈 세계 탐험.',
    icon: '🔮', gradient: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
    ready: true, isNew: false, category: 'visual',
    tags: ['Mandelbrot', 'Julia'],
  },
  {
    id: 'mandelbulb', title: 'Mandelbulb 3D', path: '/mandelbulb',
    desc: '레이마칭으로 실시간 렌더링하는 3D 프랙탈. Power 조절로 형태 변화.',
    icon: '🔷', gradient: 'linear-gradient(135deg, #7c3aed, #db2777)',
    ready: true, isNew: true, category: 'visual',
    tags: ['ray marching', '3D fractal'],
  },
  {
    id: 'raymarch', title: 'Ray Marching', path: '/raymarch',
    desc: 'GPU 3D 렌더링. SDF 기반 메타볼/멩거 스폰지/지형.',
    icon: '🎨', gradient: 'linear-gradient(135deg, #f43f5e, #a855f7)',
    ready: true, isNew: true, category: 'visual',
    tags: ['SDF', 'ray marching', '3D'],
  },
  {
    id: 'voronoi', title: 'Voronoi Diagram', path: '/voronoi',
    desc: '32개 시드가 튕기며 만드는 Voronoi 셀. 3가지 색상 모드.',
    icon: '🔵', gradient: 'linear-gradient(135deg, #06b6d4, #6366f1)',
    ready: true, isNew: true, category: 'visual',
    tags: ['32 seeds', 'distance field'],
  },
  {
    id: 'audio', title: 'Audio Visualizer', path: '/audio',
    desc: '마이크/음악에 반응하는 GPU 파티클 비주얼. 스펙트럼, 웨이브폼.',
    icon: '🎵', gradient: 'linear-gradient(135deg, #f43f5e, #ec4899)',
    ready: true, isNew: true, category: 'visual',
    tags: ['FFT', 'microphone', 'particles'],
  },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [gpuStatus, setGpuStatus] = useState<SupportStatus>('checking');
  const [activeCategory, setActiveCategory] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    checkWebGPUSupport().then(ok => setGpuStatus(ok ? 'supported' : 'unsupported'));
  }, []);

  // Background particle animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let w = 0, h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const dots: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = [];
    for (let i = 0; i < 80; i++) {
      dots.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5, a: Math.random() * 0.25 + 0.04,
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
        ctx.fillStyle = `rgba(99,102,241,${d.a})`;
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(99,102,241,0.025)';
      ctx.lineWidth = 0.5;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x, dy = dots[i].y - dots[j].y;
          if (dx * dx + dy * dy < 10000) {
            ctx.beginPath(); ctx.moveTo(dots[i].x, dots[i].y); ctx.lineTo(dots[j].x, dots[j].y); ctx.stroke();
          }
        }
      }
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener('resize', resize); };
  }, []);

  const ok = gpuStatus === 'supported';

  const categoryCounts = useMemo(() => {
    const counts: Record<FilterTab, number> = { all: SIM_MODES.length, particles: 0, cellular: 0, fluid: 0, visual: 0 };
    SIM_MODES.forEach(m => counts[m.category]++);
    return counts;
  }, []);

  const filteredSims = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return SIM_MODES.filter(m => {
      const matchCat = activeCategory === 'all' || m.category === activeCategory;
      const matchSearch = !q || m.title.toLowerCase().includes(q) || m.tags.some(t => t.toLowerCase().includes(q));
      return matchCat && matchSearch;
    });
  }, [activeCategory, searchQuery]);

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
            <span className="hero-chip">19 Simulations</span>
          </div>
          <div className={`gpu-status-bar status-${gpuStatus}`}>
            <span className="status-dot" />
            {gpuStatus === 'checking'     && 'WebGPU 지원 확인 중...'}
            {gpuStatus === 'supported'    && 'WebGPU Supported — 최고 성능으로 실행 가능'}
            {gpuStatus === 'unsupported'  && 'WebGPU 미지원 — Chrome 113+ / Edge 113+ 필요'}
          </div>
        </header>

        {/* Simulations */}
        <div className="landing-section">
          {/* Filter bar */}
          <div className="sim-filter-bar">
            <div className="category-tabs">
              {CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  className={`category-tab ${activeCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span className="cat-icon">{cat.icon}</span>
                  <span className="cat-label">{cat.label}</span>
                  <span className="cat-count">{categoryCounts[cat.id]}</span>
                </button>
              ))}
            </div>
            <div className="sim-search">
              <span className="search-icon">⌕</span>
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="search-input"
              />
              {searchQuery && (
                <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
              )}
            </div>
          </div>

          {/* Result count */}
          {(searchQuery || activeCategory !== 'all') && (
            <div className="filter-result-info">
              {filteredSims.length}개 시뮬레이션
              {activeCategory !== 'all' && <span className="filter-tag">{CATEGORIES.find(c => c.id === activeCategory)?.label}</span>}
              {searchQuery && <span className="filter-tag">"{searchQuery}"</span>}
            </div>
          )}

          {/* Sim grid — uniform, all same size */}
          {filteredSims.length > 0 && (
            <div className="mode-grid">
              {filteredSims.map(m => (
                <button
                  key={m.id}
                  className="mode-card"
                  onClick={() => ok && navigate(m.path)}
                  disabled={!ok}
                >
                  <div className="mode-icon" style={{ background: m.gradient }}>{m.icon}</div>
                  <div className="mode-info">
                    <h3>
                      {m.title}
                      {m.isNew && <span className="new-badge">NEW</span>}
                    </h3>
                    <p>{m.desc}</p>
                    <div className="sim-tags">
                      {m.tags.map(tag => <span key={tag} className="sim-tag">{tag}</span>)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {filteredSims.length === 0 && (
            <div className="no-results">
              <span>검색 결과 없음</span>
              <button onClick={() => { setSearchQuery(''); setActiveCategory('all'); }}>초기화</button>
            </div>
          )}
        </div>

        {/* Benchmark & Leaderboard */}
        <div className="landing-section">
          <h2 className="section-title"><span className="section-icon">📊</span> Benchmark</h2>
          <div className="mode-grid benchmark-grid">
            <button className="mode-card benchmark-card" onClick={() => ok && navigate('/benchmark')} disabled={!ok}>
              <div className="mode-icon" style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)' }}>⚡</div>
              <div className="mode-info">
                <h3>Stress Test</h3>
                <p>GPU 스트레스 테스트. 파티클을 극한까지 밀어 성능 점수 측정.</p>
              </div>
              <div className="benchmark-cta"><span>Start →</span></div>
            </button>
            <button className="mode-card leaderboard-card" onClick={() => navigate('/leaderboard')}>
              <div className="mode-icon" style={{ background: 'linear-gradient(135deg, #eab308, #f59e0b)' }}>🏆</div>
              <div className="mode-info">
                <h3>Leaderboard</h3>
                <p>로컬 벤치마크 순위표. 내 GPU 성능 비교.</p>
              </div>
            </button>
          </div>
        </div>

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
