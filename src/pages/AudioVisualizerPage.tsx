import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initWebGPU } from '../lib/webgpu';
import audioComputeCode from '../shaders/audio_compute.wgsl?raw';
import audioRenderCode from '../shaders/audio_render.wgsl?raw';
import { useSimKeyboard } from '../hooks/useSimKeyboard';
import { ShareButton } from '../components/ShareButton';
import { TutorialOverlay } from '../components/TutorialOverlay';

const MAX_PARTICLES = 4096;
const FFT_SIZE = 512;
const BIN_COUNT = FFT_SIZE / 2; // 256

type AudioSource = 'mic' | 'file';
type VisMode = 0 | 1 | 2;
type ColorMode = 0 | 1 | 2 | 3;

const VIS_MODES: { id: VisMode; label: string }[] = [
  { id: 0, label: 'Circular' },
  { id: 1, label: 'Particle Field' },
  { id: 2, label: 'Waveform' },
];

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 0, label: 'Rainbow' },
  { id: 1, label: 'Neon' },
  { id: 2, label: 'Fire' },
  { id: 3, label: 'Ocean' },
];

function initParticles(count: number): Float32Array<ArrayBuffer> {
  const data = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * 0.8;
    const offset = i * 8;
    data[offset + 0] = Math.cos(angle) * radius; // x
    data[offset + 1] = Math.sin(angle) * radius; // y
    data[offset + 2] = (Math.random() - 0.5) * 0.1; // vx
    data[offset + 3] = (Math.random() - 0.5) * 0.1; // vy
    data[offset + 4] = Math.random(); // life
    data[offset + 5] = Math.random(); // freq (normalized 0-1)
    data[offset + 6] = 0.5 + Math.random() * 0.5; // size
    data[offset + 7] = 0.5 + Math.random() * 0.5; // brightness
  }
  return data;
}

export const AudioVisualizerPage: React.FC = () => {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const gpuRef = useRef<{
    device: GPUDevice;
    canvasContext: GPUCanvasContext;
    computePipeline: GPUComputePipeline;
    renderPipeline: GPURenderPipeline;
    particleBuffers: GPUBuffer[];
    fftBuffer: GPUBuffer;
    computeUniformBuffer: GPUBuffer;
    renderUniformBuffer: GPUBuffer;
    computeBindGroups: GPUBindGroup[];
    renderBindGroups: GPUBindGroup[];
    currentBuffer: number;
  } | null>(null);

  const audioRef = useRef<{
    context: AudioContext;
    analyser: AnalyserNode;
    source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null;
    stream: MediaStream | null;
  } | null>(null);

  const rafRef = useRef(0);
  const activeRef = useRef(true);
  const lastTimeRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const fpsFrames = useRef(0);
  const fpsTime = useRef(0);
  const fftDataRef = useRef(new Uint8Array(BIN_COUNT));

  const [audioSource, setAudioSource] = useState<AudioSource>('mic');
  const [visMode, setVisMode] = useState<VisMode>(0);
  const [colorMode, setColorMode] = useState<ColorMode>(0);
  const [sensitivity, setSensitivity] = useState(1.5);
  const [particleScale, setParticleScale] = useState(1.0);
  const [fps, setFps] = useState(0);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [audioActive, setAudioActive] = useState(false);
  const [audioFileName, setAudioFileName] = useState('');

  const paramsRef = useRef({
    visMode: 0 as VisMode,
    colorMode: 0 as ColorMode,
    sensitivity: 1.5,
    particleScale: 1.0,
  });

  useEffect(() => {
    paramsRef.current = { visMode, colorMode, sensitivity, particleScale };
  }, [visMode, colorMode, sensitivity, particleScale]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.source) {
      audio.source.disconnect();
      audio.source = null;
    }
    if (audio.stream) {
      audio.stream.getTracks().forEach(t => t.stop());
      audio.stream = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }
    setAudioActive(false);
  }, []);

  const startMic = useCallback(async () => {
    stopAudio();

    let audio = audioRef.current;
    if (!audio) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      audio = { context, analyser, source: null, stream: null };
      audioRef.current = audio;
    }

    if (audio.context.state === 'suspended') {
      await audio.context.resume();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!activeRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      audio.stream = stream;
      const source = audio.context.createMediaStreamSource(stream);
      source.connect(audio.analyser);
      audio.source = source;
      setAudioActive(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [stopAudio]);

  const startFile = useCallback(async (file: File) => {
    stopAudio();

    let audio = audioRef.current;
    if (!audio) {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      audio = { context, analyser, source: null, stream: null };
      audioRef.current = audio;
    }

    if (audio.context.state === 'suspended') {
      await audio.context.resume();
    }

    const audioEl = new Audio();
    audioEl.crossOrigin = 'anonymous';
    audioEl.src = URL.createObjectURL(file);
    audioEl.loop = true;
    audioElementRef.current = audioEl;

    const source = audio.context.createMediaElementSource(audioEl);
    source.connect(audio.analyser);
    audio.analyser.connect(audio.context.destination);
    audio.source = source;

    await audioEl.play();
    setAudioActive(true);
    setAudioFileName(file.name);
  }, [stopAudio]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      startFile(file);
    }
  }, [startFile]);

  const takeScreenshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `audio-visualizer-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, []);

  useSimKeyboard({
    onPause: stopAudio,
    onReset: stopAudio,
    onScreenshot: takeScreenshot,
  });

  const initGPU = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gpuCtx = await initWebGPU(canvas);
    if (!gpuCtx || !activeRef.current) return;
    const { device, format, canvasContext } = gpuCtx;

    const computeModule = device.createShaderModule({ code: audioComputeCode });
    const renderModule = device.createShaderModule({ code: audioRenderCode });

    // Each particle: 8 floats = 32 bytes
    const particleByteSize = MAX_PARTICLES * 8 * 4;
    const particleBuffers = [0, 1].map(() => device.createBuffer({
      size: particleByteSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));

    const initialData = initParticles(MAX_PARTICLES);
    device.queue.writeBuffer(particleBuffers[0], 0, initialData);
    device.queue.writeBuffer(particleBuffers[1], 0, initialData);

    // FFT data buffer: 256 floats
    const fftBuffer = device.createBuffer({
      size: BIN_COUNT * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Compute uniform: 16 floats = 64 bytes
    const computeUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render uniform: 4 floats = 16 bytes
    const renderUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Compute bind group layout
    const computeBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });

    const computeBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: computeBGL,
      entries: [
        { binding: 0, resource: { buffer: computeUniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffers[i] } },
        { binding: 2, resource: { buffer: particleBuffers[1 - i] } },
        { binding: 3, resource: { buffer: fftBuffer } },
      ],
    }));

    const computePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });

    // Render bind group layout
    const renderBGL = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    });

    const renderBindGroups = [0, 1].map(i => device.createBindGroup({
      layout: renderBGL,
      entries: [
        { binding: 0, resource: { buffer: renderUniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffers[i] } },
      ],
    }));

    const renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBGL] }),
      vertex: {
        module: renderModule,
        entryPoint: 'vs_main',
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
      particleBuffers, fftBuffer, computeUniformBuffer, renderUniformBuffer,
      computeBindGroups, renderBindGroups, currentBuffer: 0,
    };
  }, []);

  const render = useCallback((time: number) => {
    if (!activeRef.current) return;
    const gpu = gpuRef.current;
    if (!gpu) { rafRef.current = requestAnimationFrame(render); return; }

    let dt = (time - lastTimeRef.current) / 1000;
    lastTimeRef.current = time;
    if (dt > 0.1) dt = 0.016;

    const params = paramsRef.current;
    const mouse = mouseRef.current;

    // Extract FFT data from analyser
    const analyser = audioRef.current?.analyser;
    const fftRaw = fftDataRef.current;
    if (analyser) {
      analyser.getByteFrequencyData(fftRaw);
    } else {
      fftRaw.fill(0);
    }

    // Convert FFT data to float and upload
    const fftFloat = new Float32Array(BIN_COUNT);
    let totalLevel = 0;
    for (let i = 0; i < BIN_COUNT; i++) {
      fftFloat[i] = (fftRaw[i] / 255.0) * params.sensitivity;
      totalLevel += fftRaw[i];
    }
    gpu.device.queue.writeBuffer(gpu.fftBuffer, 0, fftFloat);

    // Calculate band levels (bass, mid, treble)
    let bassSum = 0, bassCount = 0;
    let midSum = 0, midCount = 0;
    let trebleSum = 0, trebleCount = 0;

    for (let i = 0; i < BIN_COUNT; i++) {
      const val = fftFloat[i];
      if (i < 60) {
        bassSum += val;
        bassCount++;
      } else if (i < 180) {
        midSum += val;
        midCount++;
      } else {
        trebleSum += val;
        trebleCount++;
      }
    }

    const bassLevel = bassCount > 0 ? Math.min(bassSum / bassCount, 1.0) : 0;
    const midLevel = midCount > 0 ? Math.min(midSum / midCount, 1.0) : 0;
    const trebleLevel = trebleCount > 0 ? Math.min(trebleSum / trebleCount, 1.0) : 0;

    // Volume level for UI indicator
    const avgLevel = totalLevel / (BIN_COUNT * 255);
    setVolumeLevel(avgLevel * params.sensitivity);

    const canvas = canvasRef.current!;

    // Write compute uniform (16 floats)
    const computeU = new Float32Array(16);
    computeU[0] = time / 1000.0;      // time
    computeU[1] = dt;                  // dt
    const computeU32 = new Uint32Array(computeU.buffer);
    computeU32[2] = MAX_PARTICLES;     // particleCount
    computeU32[3] = params.visMode;    // mode
    computeU[4] = bassLevel;           // bassLevel
    computeU[5] = midLevel;            // midLevel
    computeU[6] = trebleLevel;         // trebleLevel
    computeU[7] = mouse.x;            // mouseX
    computeU[8] = mouse.y;            // mouseY
    computeU[9] = canvas.width;       // canvasWidth
    computeU[10] = canvas.height;     // canvasHeight
    computeU[11] = 0.0;              // pad
    computeU[12] = 0.0;              // pad
    computeU[13] = 0.0;              // pad
    computeU[14] = 0.0;              // pad
    computeU[15] = 0.0;              // pad
    gpu.device.queue.writeBuffer(gpu.computeUniformBuffer, 0, computeU);

    // Write render uniform (4 floats)
    const aspectRatio = canvas.width / canvas.height;
    const renderU = new Float32Array([aspectRatio, params.particleScale, params.colorMode, 0.0]);
    gpu.device.queue.writeBuffer(gpu.renderUniformBuffer, 0, renderU);

    const encoder = gpu.device.createCommandEncoder();

    // Compute pass
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(gpu.computePipeline);
    computePass.setBindGroup(0, gpu.computeBindGroups[gpu.currentBuffer]);
    computePass.dispatchWorkgroups(Math.ceil(MAX_PARTICLES / 256));
    computePass.end();

    const outIdx = 1 - gpu.currentBuffer;

    // Render pass
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: gpu.canvasContext.getCurrentTexture().createView(),
        clearValue: { r: 0.02, g: 0.01, b: 0.05, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(gpu.renderPipeline);
    renderPass.setBindGroup(0, gpu.renderBindGroups[outIdx]);
    renderPass.draw(4, MAX_PARTICLES);
    renderPass.end();

    gpu.device.queue.submit([encoder.finish()]);
    gpu.currentBuffer = outIdx;

    // FPS counter
    fpsFrames.current++;
    const now = performance.now();
    if (now - fpsTime.current >= 500) {
      setFps(Math.round((fpsFrames.current * 1000) / (now - fpsTime.current)));
      fpsFrames.current = 0;
      fpsTime.current = now;
    }

    rafRef.current = requestAnimationFrame(render);
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouseRef.current.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    };

    canvas.addEventListener('mousemove', onMove);

    lastTimeRef.current = performance.now();
    fpsTime.current = performance.now();
    initGPU().then(() => { rafRef.current = requestAnimationFrame(render); });

    return () => {
      activeRef.current = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);

      // Stop audio
      const audio = audioRef.current;
      if (audio) {
        if (audio.source) {
          audio.source.disconnect();
        }
        if (audio.stream) {
          audio.stream.getTracks().forEach(t => t.stop());
        }
        audio.context.close();
        audioRef.current = null;
      }
      if (audioElementRef.current) {
        audioElementRef.current.pause();
        audioElementRef.current.src = '';
        audioElementRef.current = null;
      }

      // Destroy GPU resources
      if (gpuRef.current) {
        gpuRef.current.particleBuffers.forEach(b => b.destroy());
        gpuRef.current.fftBuffer.destroy();
        gpuRef.current.computeUniformBuffer.destroy();
        gpuRef.current.renderUniformBuffer.destroy();
        gpuRef.current.device.destroy();
        gpuRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container dark">
      <main className="canvas-container">
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </main>
      <div className="ui-overlay">
        <header className="ui-header">
          <div className="header-left">
            <button className="icon-btn" onClick={() => navigate('/')}>←</button>
            <h1>Audio Visualizer</h1>
            <span className="badge">
              {audioActive ? (audioSource === 'mic' ? 'Mic Active' : audioFileName || 'Playing') : 'No Audio'}
            </span>
          </div>
          <div className="header-right">
            <div className="stats">
              <span className={`fps ${fps >= 55 ? 'fps-good' : fps >= 30 ? 'fps-mid' : 'fps-low'}`}>{fps} FPS</span>
              <span className="divider">|</span>
              <span className="particles">{MAX_PARTICLES} particles</span>
            </div>
          </div>
        </header>

        <aside className="ui-controls">
          {/* Audio Source */}
          <div className="control-group">
            <label>Audio Source</label>
            <div className="control-group actions-row">
              <button
                className={`action-btn ${audioSource === 'mic' && audioActive ? 'primary' : ''}`}
                onClick={() => {
                  setAudioSource('mic');
                  startMic();
                }}
              >
                Mic
              </button>
              <button
                className={`action-btn ${audioSource === 'file' && audioActive ? 'primary' : ''}`}
                onClick={() => {
                  setAudioSource('file');
                  audioFileRef.current?.click();
                }}
              >
                File
              </button>
            </div>
            <input
              ref={audioFileRef}
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* Volume Level Indicator */}
          <div className="control-group">
            <label>Volume Level</label>
            <div style={{
              width: '100%',
              height: '8px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.min(volumeLevel * 100, 100)}%`,
                height: '100%',
                background: volumeLevel > 0.7
                  ? '#ef4444'
                  : volumeLevel > 0.4
                    ? '#f59e0b'
                    : '#22c55e',
                borderRadius: '4px',
                transition: 'width 0.05s ease-out',
              }} />
            </div>
          </div>

          {/* Visualization Mode */}
          <div className="control-group">
            <label>Visualization</label>
            <div className="control-group actions-row">
              {VIS_MODES.map(m => (
                <button
                  key={m.id}
                  className={`action-btn ${visMode === m.id ? 'primary' : ''}`}
                  onClick={() => setVisMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color Mode */}
          <div className="control-group">
            <label>Color Mode</label>
            <div className="control-group actions-row" style={{ flexWrap: 'wrap' }}>
              {COLOR_MODES.map(m => (
                <button
                  key={m.id}
                  className={`action-btn ${colorMode === m.id ? 'primary' : ''}`}
                  onClick={() => setColorMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sensitivity */}
          <div className="control-group">
            <label>Sensitivity <span className="value">{sensitivity.toFixed(1)}</span></label>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={sensitivity}
              onChange={e => setSensitivity(Number(e.target.value))}
            />
            <div className="range-values"><span>0.5</span><span>3.0</span></div>
          </div>

          {/* Particle Scale */}
          <div className="control-group">
            <label>Particle Scale <span className="value">{particleScale.toFixed(1)}</span></label>
            <input
              type="range"
              min="0.2"
              max="3.0"
              step="0.1"
              value={particleScale}
              onChange={e => setParticleScale(Number(e.target.value))}
            />
            <div className="range-values"><span>0.2</span><span>3.0</span></div>
          </div>

          {/* Stop Audio */}
          <div className="control-group actions-row">
            <button className="action-btn" onClick={stopAudio}>
              Stop Audio
            </button>
            <ShareButton canvasRef={canvasRef} title="Audio Visualizer" />
          </div>

          <div className="hints">
            <span>Select Mic or load an audio file to start</span>
            <span>Move mouse to interact with particles</span>
            <span>WebGPU + Web Audio API powered</span>
          </div>
        </aside>
      </div>
      <TutorialOverlay
        id="audio"
        steps={[
          { icon: '🎤', title: '마이크', desc: '마이크 버튼으로 실시간 오디오 입력' },
          { icon: '🎵', title: '파일', desc: '음악 파일 업로드도 가능' },
          { icon: '🌈', title: '비주얼 모드', desc: '원형/파티클/웨이브폼 3가지' },
          { icon: '⚙️', title: '감도', desc: '감도와 파티클 크기 조절 가능' },
        ]}
        onClose={() => {}}
      />
    </div>
  );
};
