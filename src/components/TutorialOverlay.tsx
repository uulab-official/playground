import { useCallback, useEffect, useRef, useState } from 'react';

export interface TutorialStep {
  icon: string;
  title: string;
  desc: string;
}

interface TutorialOverlayProps {
  id: string;
  steps: TutorialStep[];
  onClose: () => void;
}

function storageKey(id: string) {
  return `tutorial-seen-${id}`;
}

export const TutorialOverlay: React.FC<TutorialOverlayProps> = ({ id, steps, onClose }) => {
  const [visible, setVisible] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const seen = localStorage.getItem(storageKey(id));
    if (!seen) {
      setVisible(true);
    }
  }, [id]);

  const handleClose = useCallback(() => {
    if (dontShow) {
      localStorage.setItem(storageKey(id), '1');
    }
    // Fade out via class, then fully unmount
    const el = overlayRef.current;
    if (el) {
      el.classList.add('tutorial-overlay--out');
      const onEnd = () => {
        setVisible(false);
        onClose();
      };
      el.addEventListener('animationend', onEnd, { once: true });
    } else {
      setVisible(false);
      onClose();
    }
  }, [id, dontShow, onClose]);

  // Keyboard: Escape to dismiss
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, handleClose]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      className="tutorial-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Tutorial"
      onClick={(e) => {
        // Dismiss when clicking the backdrop (not the box)
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="tutorial-box">
        {/* Header */}
        <div className="tutorial-header">
          <span className="tutorial-header__eyebrow">Quick Start</span>
          <h2 className="tutorial-header__title">How to use</h2>
        </div>

        {/* Step cards */}
        <div className="tutorial-steps">
          {steps.map((step, i) => (
            <div key={i} className="tutorial-step">
              <span className="tutorial-step__icon" aria-hidden="true">
                {step.icon}
              </span>
              <strong className="tutorial-step__title">{step.title}</strong>
              <p className="tutorial-step__desc">{step.desc}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="tutorial-footer">
          <label className="tutorial-dont-show">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
            />
            <span>Don't show again</span>
          </label>

          <button className="tutorial-cta" onClick={handleClose}>
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};
