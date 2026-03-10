export async function checkWebGPUSupport(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export interface WebGPUContextInfo {
  device: GPUDevice;
  format: GPUTextureFormat;
  canvasContext: GPUCanvasContext;
  adapter: GPUAdapter;
}

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContextInfo | null> {
  if (!navigator.gpu) return null;

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return null;

  // Request higher limits for large particle counts
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
    },
  });

  const context = canvas.getContext('webgpu');
  if (!context) return null;

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { device, format, canvasContext: context as GPUCanvasContext, adapter };
}

export function getGPUInfo(adapter: GPUAdapter): string {
  const info = (adapter as GPUAdapter & { info?: { vendor?: string; architecture?: string } }).info;
  if (info) {
    return `${info.vendor || 'Unknown'} ${info.architecture || ''}`.trim();
  }
  return 'WebGPU Device';
}
