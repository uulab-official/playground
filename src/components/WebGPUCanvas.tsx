import React, { useEffect, useRef } from 'react';
import { useSimulationStore } from '../stores/useSimulationStore';
import { initWebGPU } from '../lib/webgpu';
import computeShaderCode from '../shaders/compute.wgsl?raw';
import renderShaderCode from '../shaders/render.wgsl?raw';

export const WebGPUCanvas: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { particleCount, isPaused, setPerformanceMetrics } = useSimulationStore();
    const requestRef = useRef<number>(0);
    const lastTimeRef = useRef<number>(0);

    useEffect(() => {
        let active = true;
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Handle resize
        const resizeCanvas = () => {
            canvas.width = canvas.clientWidth * window.devicePixelRatio;
            canvas.height = canvas.clientHeight * window.devicePixelRatio;
        };
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        const setupGPU = async () => {
            const gpuCtx = await initWebGPU(canvas);
            if (!gpuCtx || !active) return;
            const { device, format, canvasContext } = gpuCtx;

            // Create shader modules
            const computeModule = device.createShaderModule({ code: computeShaderCode });
            const renderModule = device.createShaderModule({ code: renderShaderCode });

            // Create uniform buffer
            const uniformBufferSize = 4 * 8; // 8 floats (deltaTime, gravity, damping, width, height, isPaused, pad1, pad2)
            const uniformBuffer = device.createBuffer({
                size: uniformBufferSize,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });

            // Create particle buffer
            // Particle logic struct: pos(2 floats), vel(2 floats) = 16 bytes per particle
            const initialParticles = new Float32Array(particleCount * 4);
            for (let i = 0; i < particleCount; i++) {
                initialParticles[i * 4 + 0] = (Math.random() * 2 - 1) * 0.9; // x
                initialParticles[i * 4 + 1] = (Math.random() * 2 - 1) * 0.9; // y
                initialParticles[i * 4 + 2] = (Math.random() * 2 - 1) * 0.1; // vx
                initialParticles[i * 4 + 3] = (Math.random() * 2 - 1) * 0.1; // vy
            }

            const particleBuffer = device.createBuffer({
                size: initialParticles.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(particleBuffer, 0, initialParticles);

            // Create bind group layout for compute
            const computeBindGroupLayout = device.createBindGroupLayout({
                entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                ],
            });

            const computeBindGroup = device.createBindGroup({
                layout: computeBindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: particleBuffer } },
                ],
            });

            const computePipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] });
            const computePipeline = device.createComputePipeline({
                layout: computePipelineLayout,
                compute: { module: computeModule, entryPoint: 'cs_main' },
            });

            // Render Pipeline
            const renderPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [] });
            const renderPipeline = device.createRenderPipeline({
                layout: renderPipelineLayout,
                vertex: {
                    module: renderModule,
                    entryPoint: 'vs_main',
                    buffers: [
                        {
                            arrayStride: 16,
                            stepMode: 'instance',
                            attributes: [
                                { shaderLocation: 0, offset: 0, format: 'float32x2' }, // pos
                                { shaderLocation: 1, offset: 8, format: 'float32x2' }, // vel
                            ],
                        },
                    ],
                },
                fragment: {
                    module: renderModule,
                    entryPoint: 'fs_main',
                    targets: [{
                        format, blend: {
                            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
                            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
                        }
                    }],
                },
                primitive: { topology: 'triangle-strip' },
            });

            let frames = 0;
            let lastFpsTime = performance.now();

            const render = (time: number) => {
                if (!active) return;

                let deltaTime = (time - lastTimeRef.current) / 1000;
                lastTimeRef.current = time;
                if (deltaTime > 0.1) deltaTime = 0.1; // Clamp

                // Update Uniforms
                const uniforms = new Float32Array([
                    deltaTime,
                    0.98, // gravity
                    0.8, // damping
                    canvas.width,
                    canvas.height,
                    isPaused ? 1.0 : 0.0,
                    0.0, 0.0 // padding
                ]);
                device.queue.writeBuffer(uniformBuffer, 0, uniforms);

                const commandEncoder = device.createCommandEncoder();

                // 1. Compute Pass
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(computePipeline);
                computePass.setBindGroup(0, computeBindGroup);
                const workgroupCount = Math.ceil(particleCount / 64);
                computePass.dispatchWorkgroups(workgroupCount);
                computePass.end();

                // 2. Render Pass
                const textureView = canvasContext.getCurrentTexture().createView();
                const renderPassDescriptor: GPURenderPassDescriptor = {
                    colorAttachments: [
                        {
                            view: textureView,
                            clearValue: { r: 0.05, g: 0.05, b: 0.05, a: 1.0 },
                            loadOp: 'clear',
                            storeOp: 'store',
                        },
                    ],
                };

                const renderPass = commandEncoder.beginRenderPass(renderPassDescriptor);
                renderPass.setPipeline(renderPipeline);
                renderPass.setVertexBuffer(0, particleBuffer);
                // We draw a quad (4 vertices) per particle (instance)
                renderPass.draw(4, particleCount, 0, 0);
                renderPass.end();

                device.queue.submit([commandEncoder.finish()]);

                // FPS Calculation
                frames++;
                const now = performance.now();
                if (now - lastFpsTime >= 500) {
                    const currentFps = (frames * 1000) / (now - lastFpsTime);
                    const avgFrameTime = (now - lastFpsTime) / frames;
                    setPerformanceMetrics(Math.round(currentFps), avgFrameTime);
                    frames = 0;
                    lastFpsTime = now;
                }

                requestRef.current = requestAnimationFrame(render);
            };

            lastTimeRef.current = performance.now();
            requestRef.current = requestAnimationFrame(render);
        };

        setupGPU();

        return () => {
            active = false;
            window.removeEventListener('resize', resizeCanvas);
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
            }
        };
    }, [particleCount, isPaused, setPerformanceMetrics]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: '100%',
                height: '100%',
                display: 'block',
                backgroundColor: '#000'
            }}
        />
    );
};
