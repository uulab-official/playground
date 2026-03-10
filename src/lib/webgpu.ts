/**
 * Returns true if WebGPU is supported by the current browser.
 */
export async function checkWebGPUSupport(): Promise<boolean> {
    if (!navigator.gpu) {
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            return false;
        }
        return true;
    } catch (e) {
        console.error('WebGPU support check failed:', e);
        return false;
    }
}

export interface WebGPUContextInfo {
    device: GPUDevice;
    format: GPUTextureFormat;
    canvasContext: GPUCanvasContext;
}

/**
 * Initializes a WebGPU context for the given canvas.
 * @param canvas HTMLCanvasElement to initialize context on
 * @returns WebGPUContextInfo or null if initialization fails
 */
export async function initWebGPU(canvas: HTMLCanvasElement): Promise<WebGPUContextInfo | null> {
    if (!navigator.gpu) {
        console.warn("WebGPU is not supported in this browser.");
        return null;
    }

    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: 'high-performance', // Prefer discrete GPU for benchmarks
    });

    if (!adapter) {
        console.warn("No suitable GPU adapter found.");
        return null;
    }

    const device = await adapter.requestDevice();

    const context = canvas.getContext('webgpu');
    if (!context) {
        console.warn("Failed to get WebGPU context from canvas.");
        return null;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format,
        alphaMode: 'premultiplied',
    });

    return {
        device,
        format,
        canvasContext: context as GPUCanvasContext,
    };
}
