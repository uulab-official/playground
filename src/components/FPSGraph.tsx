import { useEffect, useRef } from 'react';
import { useSimulationStore } from '../stores/useSimulationStore';

export const FPSGraph: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameTimes = useSimulationStore((s) => s.frameTimes);
  const fps = useSimulationStore((s) => s.fps);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    if (frameTimes.length < 2) return;

    // Convert frame times to FPS values
    const fpsValues = frameTimes.map(ft => Math.min(1000 / ft, 144));
    const maxFps = 144;
    const minFps = 0;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 0.5;
    for (const target of [30, 60, 120]) {
      const y = h - (target / maxFps) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Draw FPS line
    const gradient = ctx.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, 'rgba(239, 68, 68, 0.8)');   // red (low fps)
    gradient.addColorStop(0.3, 'rgba(245, 158, 11, 0.8)'); // orange
    gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.8)'); // green (60fps)
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.8)');   // indigo (high fps)

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    const step = w / (fpsValues.length - 1);
    for (let i = 0; i < fpsValues.length; i++) {
      const x = i * step;
      const y = h - ((fpsValues[i] - minFps) / (maxFps - minFps)) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill area under curve
    const fillGradient = ctx.createLinearGradient(0, h, 0, 0);
    fillGradient.addColorStop(0, 'rgba(99, 102, 241, 0.0)');
    fillGradient.addColorStop(1, 'rgba(99, 102, 241, 0.15)');
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.fillStyle = fillGradient;
    ctx.fill();

    // FPS label
    ctx.fillStyle = fps >= 55 ? '#10b981' : fps >= 30 ? '#f59e0b' : '#ef4444';
    ctx.font = '10px Outfit, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${fps} fps`, w - 4, 12);
  }, [frameTimes, fps]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '48px',
        borderRadius: '6px',
        background: 'rgba(0, 0, 0, 0.2)',
      }}
    />
  );
};
