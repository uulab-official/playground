import { create } from 'zustand';

export type SimulationMode = 'PARTICLE' | 'SAND' | 'FLUID' | 'BENCHMARK';
export type PresetType = 'default' | 'explosion' | 'vortex' | 'rain' | 'fountain';
export type SpawnMode = 'wave' | 'burst' | 'stream';
export type MaterialType = 'normal' | 'fire' | 'water' | 'spark';

export interface SimulationSettings {
  darkMode: boolean;
  useWebGPU: boolean;
  resolutionScale: number;
  showDebugOverlay: boolean;
}

export interface MouseState {
  x: number;
  y: number;
  pressed: boolean;
  rightPressed: boolean;
}

export interface BenchmarkResult {
  gpuModel: string;
  browserVersion: string;
  totalScore: number;
  avgFps: number;
  minFps: number;
  percentile1LowFps: number;
  maxParticlesMaintained: number;
  durationSeconds: number;
  timestamp: number;
  fpsHistory: number[];
  particleHistory: number[];
}

export interface SimulationState {
  currentMode: SimulationMode;
  particleCount: number;
  fps: number;
  frameTimes: number[];
  isPaused: boolean;
  timeScale: number;
  settings: SimulationSettings;
  mouse: MouseState;
  brushSize: number;
  gravity: number;
  damping: number;
  needsReset: boolean;
  activePreset: PresetType;
  materialType: MaterialType;
  spawnMode: SpawnMode;
  continuousSpawn: boolean;
  spawnRate: number; // particles per second
  benchmarkResult: BenchmarkResult | null;
  benchmarkRunning: boolean;

  setMode: (mode: SimulationMode) => void;
  setParticleCount: (count: number) => void;
  setPerformanceMetrics: (fps: number, frameTime: number) => void;
  togglePause: () => void;
  setTimeScale: (scale: number) => void;
  updateSettings: (newSettings: Partial<SimulationSettings>) => void;
  setMouse: (mouse: Partial<MouseState>) => void;
  setBrushSize: (size: number) => void;
  setGravity: (gravity: number) => void;
  setDamping: (damping: number) => void;
  requestReset: () => void;
  clearReset: () => void;
  setPreset: (preset: PresetType) => void;
  setMaterialType: (material: MaterialType) => void;
  setSpawnMode: (mode: SpawnMode) => void;
  setContinuousSpawn: (on: boolean) => void;
  setSpawnRate: (rate: number) => void;
  setBenchmarkResult: (result: BenchmarkResult | null) => void;
  setBenchmarkRunning: (running: boolean) => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  currentMode: 'PARTICLE',
  particleCount: 50000,
  fps: 0,
  frameTimes: [],
  isPaused: false,
  timeScale: 1.0,
  settings: {
    darkMode: true,
    useWebGPU: true,
    resolutionScale: 1.0,
    showDebugOverlay: false,
  },
  mouse: { x: 0, y: 0, pressed: false, rightPressed: false },
  brushSize: 0.15,
  gravity: 0.98,
  damping: 0.8,
  needsReset: false,
  activePreset: 'default',
  materialType: 'normal',
  spawnMode: 'wave',
  continuousSpawn: false,
  spawnRate: 5000,
  benchmarkResult: null,
  benchmarkRunning: false,

  setMode: (mode) => set({ currentMode: mode }),
  setParticleCount: (count) => set({ particleCount: count, needsReset: true }),
  setPerformanceMetrics: (fps, frameTime) => set((state) => {
    const newFrameTimes = [...state.frameTimes, frameTime].slice(-120);
    return { fps, frameTimes: newFrameTimes };
  }),
  togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
  setTimeScale: (scale) => set({ timeScale: scale }),
  updateSettings: (newSettings) => set((state) => ({
    settings: { ...state.settings, ...newSettings },
  })),
  setMouse: (mouse) => set((state) => ({
    mouse: { ...state.mouse, ...mouse },
  })),
  setBrushSize: (size) => set({ brushSize: size }),
  setGravity: (gravity) => set({ gravity }),
  setDamping: (damping) => set({ damping }),
  requestReset: () => set({ needsReset: true }),
  clearReset: () => set({ needsReset: false }),
  setPreset: (preset) => {
    const presetConfigs: Record<PresetType, Partial<SimulationState>> = {
      default: { gravity: 0.98, damping: 0.8, timeScale: 1.0 },
      explosion: { gravity: 0.2, damping: 0.95, timeScale: 1.0 },
      vortex: { gravity: 0.0, damping: 0.99, timeScale: 1.0 },
      rain: { gravity: 2.5, damping: 0.3, timeScale: 1.0 },
      fountain: { gravity: 1.5, damping: 0.85, timeScale: 1.0 },
    };
    set({ activePreset: preset, needsReset: true, ...presetConfigs[preset] });
  },
  setMaterialType: (material) => set({ materialType: material }),
  setSpawnMode: (mode) => set({ spawnMode: mode }),
  setContinuousSpawn: (on) => set({ continuousSpawn: on }),
  setSpawnRate: (rate) => set({ spawnRate: rate }),
  setBenchmarkResult: (result) => set({ benchmarkResult: result }),
  setBenchmarkRunning: (running) => set({ benchmarkRunning: running }),
}));
