import { useCallback, useRef, useState } from 'react';

interface ShareButtonProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  title: string;
  params?: string;
}

const WATERMARK_TEXT = 'GPU Playground · playground.uulab.co.kr';
const WATERMARK_FONT = '600 11px Outfit, system-ui, sans-serif';
const WATERMARK_PADDING_X = 10;
const WATERMARK_PADDING_Y = 6;
const WATERMARK_MARGIN = 12;
const WATERMARK_RADIUS = 6;

function drawWatermark(sourceCanvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const offscreen = document.createElement('canvas');
    offscreen.width = sourceCanvas.width;
    offscreen.height = sourceCanvas.height;

    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      reject(new Error('Could not get 2D context'));
      return;
    }

    // Draw the original canvas content
    ctx.drawImage(sourceCanvas, 0, 0);

    // Measure watermark text
    ctx.font = WATERMARK_FONT;
    const measured = ctx.measureText(WATERMARK_TEXT);
    const textW = measured.width;
    const textH = 11; // approximate cap height for 11px font

    const pillW = textW + WATERMARK_PADDING_X * 2;
    const pillH = textH + WATERMARK_PADDING_Y * 2;

    const dpr = window.devicePixelRatio || 1;
    const pillX = offscreen.width - pillW * dpr - WATERMARK_MARGIN * dpr;
    const pillY = offscreen.height - pillH * dpr - WATERMARK_MARGIN * dpr;

    // Scale for the watermark drawing so it appears at physical pixel size
    ctx.save();
    ctx.scale(dpr, dpr);

    const scaledPillX = pillX / dpr;
    const scaledPillY = pillY / dpr;

    // Semi-transparent pill background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(scaledPillX, scaledPillY, pillW, pillH, WATERMARK_RADIUS);
    ctx.fill();

    // White text
    ctx.font = WATERMARK_FONT;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(
      WATERMARK_TEXT,
      scaledPillX + WATERMARK_PADDING_X,
      scaledPillY + pillH / 2,
    );

    ctx.restore();

    offscreen.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas toBlob returned null'));
      },
      'image/png',
    );
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const ShareButton: React.FC<ShareButtonProps> = ({ canvasRef, title, params }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'success'>('idle');
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = useCallback(() => {
    setState('success');
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setState('idle'), 2000);
  }, []);

  const handleShare = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || state === 'loading') return;

    setState('loading');

    try {
      const blob = await drawWatermark(canvas);
      const filename = `${title.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.png`;
      const file = new File([blob], filename, { type: 'image/png' });

      const shareText = params
        ? `${title} · ${params} — GPU Playground`
        : `${title} — GPU Playground`;

      if (
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title,
          text: shareText,
        });
        showSuccess();
      } else {
        // Fallback: download the file directly
        downloadBlob(blob, filename);
        showSuccess();
      }
    } catch (err) {
      // User cancelled share or another error — return to idle silently
      setState('idle');
    }
  }, [canvasRef, title, params, state, showSuccess]);

  const label =
    state === 'loading' ? '...' : state === 'success' ? 'Copied!' : 'Share';
  const icon = state === 'success' ? '✓' : '📷';

  return (
    <button
      className={`action-btn share-btn${state === 'success' ? ' share-btn--success' : ''}`}
      onClick={handleShare}
      disabled={state === 'loading'}
      aria-label="Share screenshot"
      title="Capture and share screenshot"
    >
      <span className="share-btn__icon" aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
};
