import type { PresetType } from '../stores/useSimulationStore';

export function createParticleData(count: number, preset: PresetType): Float32Array<ArrayBuffer> {
  const data = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const idx = i * 4;
    switch (preset) {
      case 'explosion': {
        // All particles start at center with random outward velocity
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.0 + 0.5;
        data[idx + 0] = (Math.random() - 0.5) * 0.05;
        data[idx + 1] = (Math.random() - 0.5) * 0.05;
        data[idx + 2] = Math.cos(angle) * speed;
        data[idx + 3] = Math.sin(angle) * speed;
        break;
      }
      case 'vortex': {
        // Ring distribution
        const r = 0.3 + Math.random() * 0.5;
        const a = Math.random() * Math.PI * 2;
        data[idx + 0] = Math.cos(a) * r;
        data[idx + 1] = Math.sin(a) * r;
        // Tangential velocity
        const tangentSpeed = 0.5 + Math.random() * 0.5;
        data[idx + 2] = -Math.sin(a) * tangentSpeed;
        data[idx + 3] = Math.cos(a) * tangentSpeed;
        break;
      }
      case 'rain': {
        // Spread across top, falling down
        data[idx + 0] = (Math.random() * 2 - 1) * 0.95;
        data[idx + 1] = Math.random() * 2 - 0.5; // Spread vertically
        data[idx + 2] = (Math.random() - 0.5) * 0.05;
        data[idx + 3] = -(Math.random() * 0.5 + 0.3);
        break;
      }
      case 'fountain': {
        // Start at bottom center, shoot up
        data[idx + 0] = (Math.random() - 0.5) * 0.1;
        data[idx + 1] = -0.9 + Math.random() * 0.3;
        data[idx + 2] = (Math.random() - 0.5) * 0.3;
        data[idx + 3] = Math.random() * 2.0 + 1.0;
        break;
      }
      default: {
        // Random scatter
        data[idx + 0] = (Math.random() * 2 - 1) * 0.9;
        data[idx + 1] = (Math.random() * 2 - 1) * 0.9;
        data[idx + 2] = (Math.random() * 2 - 1) * 0.1;
        data[idx + 3] = (Math.random() * 2 - 1) * 0.1;
        break;
      }
    }
  }
  return data;
}

export const PRESET_MODES: Record<PresetType, number> = {
  default: 0,
  explosion: 1,
  vortex: 2,
  rain: 3,
  fountain: 4,
};
