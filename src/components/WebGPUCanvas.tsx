import { useEffect, useRef, useCallback } from 'react';
import { useSimulationStore } from '../stores/useSimulationStore';
import { initWebGPU } from '../lib/webgpu';
import { createParticleData, PRESET_MODES } from '../lib/particles';
import computeShaderCode from '../shaders/compute.wgsl?raw';
import renderShaderCode from '../shaders/render.wgsl?raw';

const MAX_PARTICLES = 500000;
const UNIFORM_BUFFER_SIZE = 64; // 16 floats * 4 bytes

const MATERIAL_INDICES: Record<string, number> = {
  normal: 0,
  fire: 1,
  water: 2,
  spark: 3,
};

export const WebGPUCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    particleBuffers: GPUBuffer[];
    uniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroup: GPUBindGroup;
    currentBuffer: number;
  } | null>(null);

  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const fpsFramesRef = useRef(0);
  const fpsTimeRef = useRef(0);
  const activeRef = useRef(true);
  const spawnAccumRef = useRef(0);
  const liveCountRef = useRef(0);

  const storeRef = useRef(useSimulationStore.getState());

  useEffect(() => {
    return useSimulationStore.subscribe((state) => {
      storeRef.current = state;
    });
  }, []);

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: computeShaderCode });
    const renderModule = device.createShaderModule({ code: renderShaderCode });

    const particleByteSize = MAX_PARTICLES * 16;
    const particleBuffers = [0, 1].map(() =>
      device.createBuffer({
        size: particleByteSize,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    );

    const uniformBuffer = device.createBuffer({
      size: UNIFORM_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const store = storeRef.current;
    const initialData = createParticleData(store.particleCount, store.activePreset);
    device.queue.writeBuffer(particleBuffers[0], 0, initialData);
    device.queue.writeBuffer(particleBuffers[1], 0, initialData);
    liveCountRef.current = store.particleCount;

    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    const computeBindGroups = [0, 1].map((i) =>
      device.createBindGroup({
        layout: computeBGL,
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: particleBuffers[i] } },
          { binding: 2, resource: { buffer: particleBuffers[1 - i] } },
        ],
      })
    );

    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    const renderBindGroup = device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: renderUniformBuffer } },
      ],
    });

    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: {
        module: renderModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 16,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    gpuRef.current = {
      device, canvasContext, computePipeline, renderPipeline,
      particleBuffers, uniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroup, currentBuffer: 0,
    };
  }, []);

  const resetParticles = useCallback(() => {
    const gpu = gpuRef.current;
    if (!gpu) return;
    const store = storeRef.current;
    const data = createParticleData(store.particleCount, store.activePreset);
    gpu.device.queue.writeBuffer(gpu.particleBuffers[0], 0, data);
    gpu.device.queue.writeBuffer(gpu.particleBuffers[1], 0, data);
    liveCountRef.current = store.particleCount;
    spawnAccumRef.current = 0;
    store.clearReset();
  }, []);

  const render = useCallback((time: number) => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) {
      rafRef.current = requestAnimationFrame(render);
      return;
    }

    const store = storeRef.current;

    if (store.needsReset) {
      resetParticles();
    }

    let dt = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;
    if (dt > 0.1) dt = 0.016;

    // Continuous spawn logic
    if (store.continuousSpawn && !store.isPaused) {
      spawnAccumRef.current += store.spawnRate * dt;
      const toSpawn = Math.floor(spawnAccumRef.current);
      if (toSpawn > 0 && liveCountRef.current < MAX_PARTICLES) {
        spawnAccumRef.current -= toSpawn;
        const actualSpawn = Math.min(toSpawn, MAX_PARTICLES - liveCountRef.current);
        const spawnData = createParticleData(actualSpawn, store.activePreset);
        const offset = liveCountRef.current * 16;
        gpu.device.queue.writeBuffer(gpu.particleBuffers[gpu.currentBuffer], offset, spawnData);
        gpu.device.queue.writeBuffer(gpu.particleBuffers[1 - gpu.currentBuffer], offset, spawnData);
        liveCountRef.current += actualSpawn;
      }
    } else {
      liveCountRef.current = store.particleCount;
    }

    const drawCount = Math.min(liveCountRef.current, MAX_PARTICLES);

    const canvas = canvasRef.current!;
    const { device, canvasContext, computePipeline, renderPipeline,
      particleBuffers, uniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroup } = gpu;

    const uniforms = new Float32Array(16);
    uniforms[0] = dt;
    uniforms[1] = store.gravity;
    uniforms[2] = store.damping;
    uniforms[3] = canvas.width;
    uniforms[4] = canvas.height;
    uniforms[5] = store.isPaused ? 1.0 : 0.0;
    uniforms[6] = store.mouse.x;
    uniforms[7] = store.mouse.y;
    uniforms[8] = store.mouse.pressed ? 1.0 : 0.0;
    uniforms[9] = store.mouse.rightPressed ? 1.0 : 0.0;
    uniforms[10] = store.brushSize;
    uniforms[11] = store.timeScale;

    const uniformsU32 = new Uint32Array(uniforms.buffer);
    uniformsU32[12] = drawCount;
    uniformsU32[13] = PRESET_MODES[store.activePreset];

    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const aspectRatio = canvas.width / canvas.height;
    const particleScale = 0.003 * (1.0 / Math.sqrt(drawCount / 10000));
    const materialIdx = MATERIAL_INDICES[store.materialType] || 0;
    const renderUniforms = new Float32Array([aspectRatio, particleScale, materialIdx, 0]);
    device.queue.writeBuffer(renderUniformBuffer, 0, renderUniforms);

    const commandEncoder = device.createCommandEncoder();

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroups[gpu.currentBuffer]);
    computePass.dispatchWorkgroups(Math.ceil(drawCount / 256));
    computePass.end();

    const outputBufferIndex = 1 - gpu.currentBuffer;

    const textureView = canvasContext.getCurrentTexture().createView();
    const isDark = store.settings.darkMode;
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: isDark
          ? { r: 0.02, g: 0.02, b: 0.04, a: 1.0 }
          : { r: 0.95, g: 0.95, b: 0.97, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.setVertexBuffer(0, particleBuffers[outputBufferIndex]);
    renderPass.draw(4, drawCount, 0, 0);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
    gpu.currentBuffer = outputBufferIndex;

    fpsFramesRef.current++;
    const now = performance.now();
    if (now - fpsTimeRef.current >= 400) {
      const elapsed = now - fpsTimeRef.current;
      const currentFps = (fpsFramesRef.current * 1000) / elapsed;
      const avgFrameTime = elapsed / fpsFramesRef.current;
      store.setPerformanceMetrics(Math.round(currentFps), avgFrameTime);
      fpsFramesRef.current = 0;
      fpsTimeRef.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, [resetParticles]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    storeRef.current.setMouse({ x, y });
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    if (e.button === 0) storeRef.current.setMouse({ pressed: true });
    if (e.button === 2) storeRef.current.setMouse({ rightPressed: true });
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 0) storeRef.current.setMouse({ pressed: false });
    if (e.button === 2) storeRef.current.setMouse({ rightPressed: false });
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent) => { e.preventDefault(); }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    storeRef.current.setMouse({
      x: ((touch.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((touch.clientY - rect.top) / rect.height) * 2 - 1),
    });
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    storeRef.current.setMouse({
      x: ((touch.clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((touch.clientY - rect.top) / rect.height) * 2 - 1),
      pressed: true,
    });
  }, []);

  const handleTouchEnd = useCallback(() => {
    storeRef.current.setMouse({ pressed: false, rightPressed: false });
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio * (storeRef.current.settings.resolutionScale || 1);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };

    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas);
    resizeCanvas();

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);

    initGPU().then(() => {
      lastTimeRef.current = performance.now();
      fpsTimeRef.current = performance.now();
      rafRef.current = requestAnimationFrame(render);
    });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchend', handleTouchEnd);

      if (gpuRef.current) {
        gpuRef.current.particleBuffers.forEach(b => b.destroy());
        gpuRef.current.uniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    />
  );
};
