// Audio Visualizer - Compute Shader
// Processes FFT audio data and drives particle positions across 3 visualization modes.

struct Particle {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  life: f32,
  freq: f32,
  size: f32,
  brightness: f32,
};

struct Params {
  time: f32,
  deltaTime: f32,
  particleCount: u32,
  mode: u32,
  bassLevel: f32,
  midLevel: f32,
  trebleLevel: f32,
  mouseX: f32,
  mouseY: f32,
  width: f32,
  height: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> fftData: array<f32, 256>;
@group(0) @binding(2) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(3) var<storage, read_write> particlesOut: array<Particle>;

// --- Utility functions ---

fn hash(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

fn hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
}

// Smooth noise for turbulence
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// Fractal Brownian Motion for organic turbulence
fn fbm(p: vec2<f32>) -> f32 {
  var val = 0.0;
  var amp = 0.5;
  var pos = p;
  for (var i = 0; i < 4; i++) {
    val += amp * noise(pos);
    pos *= 2.0;
    amp *= 0.5;
  }
  return val;
}

// Sample FFT with interpolation for smooth frequency reads
fn sampleFFT(freq: f32) -> f32 {
  let idx = clamp(freq, 0.0, 255.0);
  let lo = u32(floor(idx));
  let hi = min(lo + 1u, 255u);
  let t = fract(idx);
  return mix(fftData[lo], fftData[hi], t);
}

// Smooth exponential interpolation
fn expLerp(current: f32, target: f32, speed: f32, dt: f32) -> f32 {
  return mix(current, target, 1.0 - exp(-speed * dt));
}

// --- Mode 0: Circular Spectrum ---

fn modeCircularSpectrum(idx: u32, p: Particle, dt: f32) -> Particle {
  var out = p;
  let count = f32(params.particleCount);
  let fi = f32(idx);
  let t = params.time;

  // Each particle maps to an angle around the circle
  let angle = (fi / count) * 6.2831853;
  // Map to FFT bin with wrapping for symmetry
  let freqIdx = (fi / count) * 128.0;
  let magnitude = sampleFFT(freqIdx);

  // Base radius + audio-driven expansion
  let baseRadius = 0.25;
  let audioRadius = magnitude * 0.55;
  let breathe = sin(t * 0.4) * 0.02; // subtle pulsing
  let targetRadius = baseRadius + audioRadius + breathe;

  // Smooth interpolation toward target position
  let targetX = cos(angle) * targetRadius;
  let targetY = sin(angle) * targetRadius;

  // Use velocity for smooth inertia
  let springK = 12.0;
  let damping = 4.0;
  let ax = springK * (targetX - out.x) - damping * out.vx;
  let ay = springK * (targetY - out.y) - damping * out.vy;
  out.vx += ax * dt;
  out.vy += ay * dt;
  out.x += out.vx * dt;
  out.y += out.vy * dt;

  // Frequency for coloring (0..1 mapped from bin)
  out.freq = freqIdx / 256.0;

  // Size pulses with magnitude
  out.size = 0.004 + magnitude * 0.012;

  // Brightness from magnitude with bass boost
  out.brightness = 0.4 + magnitude * 0.6 + params.bassLevel * 0.15;

  // Life stays at 1 in this mode (always visible)
  out.life = 1.0;

  return out;
}

// --- Mode 1: Particle Field ---

fn modeParticleField(idx: u32, p: Particle, dt: f32) -> Particle {
  var out = p;
  let fi = f32(idx);
  let t = params.time;

  // Initialize dead or new particles
  if (out.life <= 0.0) {
    let seed = hash(fi + t * 0.01);
    let seed2 = hash(fi * 7.13 + t * 0.017);
    out.x = (seed * 2.0 - 1.0) * 0.9;
    out.y = (seed2 * 2.0 - 1.0) * 0.9;
    out.vx = (hash(fi * 3.7 + t) - 0.5) * 0.2;
    out.vy = (hash(fi * 5.3 + t) - 0.5) * 0.2;
    out.life = 0.5 + hash(fi * 11.3) * 3.0;
    out.freq = hash(fi * 13.7);
  }

  // Audio-reactive forces
  let bass = params.bassLevel;
  let mid = params.midLevel;
  let treble = params.trebleLevel;

  // Bass creates a gravitational pull toward center with pulsing
  let toCenter = -vec2<f32>(out.x, out.y);
  let centerDist = length(toCenter);
  let gravDir = select(normalize(toCenter), vec2<f32>(0.0), centerDist < 0.001);
  let gravity = gravDir * bass * 1.5 * (1.0 / (centerDist + 0.3));

  // Mid frequencies create orbital motion
  let orbital = vec2<f32>(-out.y, out.x) * mid * 0.8;

  // Treble creates turbulence via noise field
  let noisePos = vec2<f32>(out.x * 3.0 + t * 0.3, out.y * 3.0 + t * 0.2);
  let nx = fbm(noisePos) * 2.0 - 1.0;
  let ny = fbm(noisePos + vec2<f32>(100.0, 100.0)) * 2.0 - 1.0;
  let turbulence = vec2<f32>(nx, ny) * treble * 2.5;

  // Mouse interaction - gentle attraction
  let mousePos = vec2<f32>(params.mouseX, params.mouseY);
  let toMouse = mousePos - vec2<f32>(out.x, out.y);
  let mouseDist = length(toMouse);
  let mouseForce = select(
    normalize(toMouse) * 0.5 / (mouseDist + 0.1),
    vec2<f32>(0.0),
    mouseDist < 0.01
  );

  // Combine forces
  let totalForce = gravity + orbital + turbulence + mouseForce;

  // Apply with damping for smooth motion
  let damping = 0.96;
  out.vx = out.vx * damping + totalForce.x * dt;
  out.vy = out.vy * damping + totalForce.y * dt;

  // Speed limit
  let speed = length(vec2<f32>(out.vx, out.vy));
  let maxSpeed = 1.5;
  if (speed > maxSpeed) {
    out.vx = out.vx / speed * maxSpeed;
    out.vy = out.vy / speed * maxSpeed;
  }

  out.x += out.vx * dt;
  out.y += out.vy * dt;

  // Soft boundary: push particles back instead of hard wrapping
  let boundary = 1.2;
  let pushStrength = 3.0;
  if (out.x > boundary) { out.vx -= pushStrength * dt; }
  if (out.x < -boundary) { out.vx += pushStrength * dt; }
  if (out.y > boundary) { out.vy -= pushStrength * dt; }
  if (out.y < -boundary) { out.vy += pushStrength * dt; }

  // Decay life
  out.life -= dt * 0.3;

  // Size based on audio energy at this particle's frequency
  let freqMag = sampleFFT(out.freq * 255.0);
  out.size = 0.003 + freqMag * 0.015 + bass * 0.005;

  // Brightness from combined audio + life
  out.brightness = (0.3 + freqMag * 0.5 + bass * 0.2) * clamp(out.life, 0.0, 1.0);

  return out;
}

// --- Mode 2: Waveform Ribbon ---

fn modeWaveformRibbon(idx: u32, p: Particle, dt: f32) -> Particle {
  var out = p;
  let count = f32(params.particleCount);
  let fi = f32(idx);
  let t = params.time;

  // Distribute particles along horizontal axis
  let normalizedX = fi / count; // 0..1
  let targetX = normalizedX * 2.0 - 1.0; // -1..1

  // Sample FFT for this horizontal position
  let freqIdx = normalizedX * 255.0;
  let magnitude = sampleFFT(freqIdx);

  // Create layered waveform: combine FFT data with smooth sine waves
  let wave1 = sin(normalizedX * 12.0 + t * 2.0) * 0.05;
  let wave2 = sin(normalizedX * 7.0 - t * 1.3) * 0.03;
  let wave3 = sin(normalizedX * 20.0 + t * 3.7) * 0.02 * params.trebleLevel;

  // Main waveform displacement from audio
  let audioWave = (magnitude - 0.3) * 0.5;

  // Combine for target Y
  let targetY = audioWave + wave1 + wave2 + wave3;

  // Add slight depth perspective: particles near edges curve slightly
  let perspective = (normalizedX - 0.5) * (normalizedX - 0.5) * -0.15;
  let finalTargetY = targetY + perspective;

  // Spring-damper system for smooth following
  let springK = 15.0;
  let damping = 5.0;
  let ax = springK * (targetX - out.x) - damping * out.vx;
  let ay = springK * (finalTargetY - out.y) - damping * out.vy;
  out.vx += ax * dt;
  out.vy += ay * dt;
  out.x += out.vx * dt;
  out.y += out.vy * dt;

  // Frequency for color mapping
  out.freq = normalizedX;

  // Size varies along the ribbon: thicker in the middle
  let centerFactor = 1.0 - abs(normalizedX - 0.5) * 1.2;
  out.size = (0.003 + magnitude * 0.01) * (0.5 + centerFactor * 0.5);

  // Brightness from magnitude with smooth falloff at edges
  let edgeFade = smoothstep(0.0, 0.05, normalizedX) * smoothstep(1.0, 0.95, normalizedX);
  out.brightness = (0.4 + magnitude * 0.6) * edgeFade;

  out.life = 1.0;

  return out;
}

// --- Main compute entry point ---

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) { return; }

  let p = particlesIn[idx];
  let dt = clamp(params.deltaTime, 0.0, 0.05); // cap delta to avoid instability

  var result: Particle;

  switch params.mode {
    case 0u: {
      result = modeCircularSpectrum(idx, p, dt);
    }
    case 1u: {
      result = modeParticleField(idx, p, dt);
    }
    case 2u: {
      result = modeWaveformRibbon(idx, p, dt);
    }
    default: {
      result = modeCircularSpectrum(idx, p, dt);
    }
  }

  particlesOut[idx] = result;
}
