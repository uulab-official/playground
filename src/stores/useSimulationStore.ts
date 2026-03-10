import { create } from 'zustand';

export type SimulationMode = 'PARTICLE' | 'SAND' | 'FLUID' | 'BENCHMARK';

export interface SimulationSettings {
  darkMode: boolean;
  useWebGPU: boolean;
  resolutionScale: number; // 0.5 to 1.0
}

export interface SimulationState {
  currentMode: SimulationMode;
  particleCount: number;
  fps: number;
  frameTimes: number[];
  isPaused: boolean;
  timeScale: number;
  settings: SimulationSettings;

  // Actions
  setMode: (mode: SimulationMode) => void;
  setParticleCount: (count: number) => void;
  setPerformanceMetrics: (fps: number, frameTime: number) => void;
  togglePause: () => void;
  setTimeScale: (scale: number) => void;
  updateSettings: (newSettings: Partial<SimulationSettings>) => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  currentMode: 'PARTICLE',
  particleCount: 10000,
  fps: 0,
  frameTimes: [],
  isPaused: false,
  timeScale: 1.0,
  settings: {
    darkMode: true,
    useWebGPU: true, // Optimistically true, updated by feature detection
    resolutionScale: 1.0,
  },

  setMode: (mode) => set({ currentMode: mode }),
  setParticleCount: (count) => set({ particleCount: count }),
  setPerformanceMetrics: (fps, frameTime) => set((state) => {
    const newFrameTimes = [...state.frameTimes, frameTime].slice(-60); // Keep last 60 frames for chart
    return { fps, frameTimes: newFrameTimes };
  }),
  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
  setTimeScale: (scale) => set({ timeScale: scale }),
  updateSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings }
  })),
}));
