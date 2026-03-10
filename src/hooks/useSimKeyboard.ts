import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface Options {
  onPause?: () => void;
  onReset?: () => void;
  onScreenshot?: () => void;
}

/**
 * Unified keyboard shortcuts for all simulation pages.
 * Space = pause/resume, R = reset, Esc = back to home, S = screenshot
 */
export function useSimKeyboard({ onPause, onReset, onScreenshot }: Options = {}) {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          onPause?.();
          break;
        case 'r':
        case 'R':
          onReset?.();
          break;
        case 'Escape':
          navigate('/');
          break;
        case 's':
        case 'S':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            onScreenshot?.();
          }
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, onPause, onReset, onScreenshot]);
}
