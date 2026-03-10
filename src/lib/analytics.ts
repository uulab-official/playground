/* Google Analytics 4 event tracking helpers */

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function track(eventName: string, params?: Record<string, unknown>) {
  window.gtag?.('event', eventName, params);
}

export const analytics = {
  pageView: (path: string) =>
    track('page_view', { page_path: path }),

  simulationStart: (name: string) =>
    track('simulation_start', { simulation: name }),

  simulationScreenshot: (name: string) =>
    track('screenshot', { simulation: name }),

  benchmarkComplete: (score: number, grade: string) =>
    track('benchmark_complete', { score, grade }),

  benchmarkShare: () =>
    track('benchmark_share'),

  proModalOpen: () =>
    track('pro_modal_open'),

  proTrialStart: () =>
    track('pro_trial_start'),
};
