import { useState, type ReactNode } from 'react';

/* ── ProModal ─────────────────────────────────────────────── */

interface ProModalProps {
  onClose: () => void;
}

function ProModal({ onClose }: ProModalProps) {
  const handleStart = () => {
    localStorage.setItem('pro-mode', 'true');
    onClose();
    // Force re-render by reloading the protected content
    window.dispatchEvent(new Event('pro-mode-changed'));
  };

  return (
    <div className="pro-modal-backdrop" onClick={onClose}>
      <div
        className="pro-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
      >
        <button
          className="pro-modal-dismiss"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        <div className="pro-modal-header">
          <div className="pro-modal-icon">⚡</div>
          <h2 id="pro-modal-title" className="pro-modal-title gradient-text">
            GPU Playground Pro
          </h2>
          <p className="pro-modal-tagline">
            모든 기능을 제한 없이 경험하세요
          </p>
        </div>

        <ul className="pro-features-list">
          <li><span className="pro-check">✓</span> Unlimited simulations</li>
          <li><span className="pro-check">✓</span> Custom shader editor</li>
          <li><span className="pro-check">✓</span> Global leaderboard</li>
          <li><span className="pro-check">✓</span> HD screenshot export (4K)</li>
          <li><span className="pro-check">✓</span> Simulation presets save &amp; share</li>
        </ul>

        <div className="pro-pricing">
          <span className="pro-price">₩4,900 / 월</span>
          <span className="pro-trial-badge">무료 7일 체험</span>
        </div>

        <div className="pro-modal-actions">
          <button className="cta-button pro-start-btn" onClick={handleStart}>
            체험 시작하기
          </button>
          <button className="pro-dismiss-link" onClick={onClose}>
            나중에
          </button>
        </div>

        <p className="pro-notice">실제 결제는 곧 지원됩니다</p>
      </div>
    </div>
  );
}

/* ── ProGate ──────────────────────────────────────────────── */

interface ProGateProps {
  feature: string;
  children: ReactNode;
  free?: boolean;
}

function isPro(): boolean {
  return localStorage.getItem('pro-mode') === 'true';
}

export function ProGate({ feature, children, free = false }: ProGateProps) {
  const [proActive, setProActive] = useState<boolean>(isPro);
  const [modalOpen, setModalOpen] = useState(false);

  // Listen for pro-mode-changed event triggered after modal activation
  useState(() => {
    const handler = () => setProActive(isPro());
    window.addEventListener('pro-mode-changed', handler);
    return () => window.removeEventListener('pro-mode-changed', handler);
  });

  const canAccess = free || proActive;

  if (canAccess) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="pro-gate">
        <div className="pro-gate-blur-layer" aria-hidden="true">
          {children}
        </div>

        <div className="pro-gate-overlay">
          <div className="pro-gate-content">
            <span className="pro-gate-lock" aria-hidden="true">🔒</span>
            <span className="pro-gate-badge">Pro</span>
            <p className="pro-gate-feature">{feature}</p>
            <button
              className="cta-button pro-gate-cta"
              onClick={() => setModalOpen(true)}
            >
              Try Pro
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <ProModal onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}

export default ProGate;
