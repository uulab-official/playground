struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
};

struct SimulationParams {
  deltaTime: f32,
  gravity: f32,
  damping: f32,
  canvasWidth: f32,
  canvasHeight: f32,
  isPaused: f32,
  mouseX: f32,
  mouseY: f32,
  mousePressed: f32,
  mouseRightPressed: f32,
  brushSize: f32,
  timeScale: f32,
  particleCount: u32,
  presetMode: u32,   // 0=default, 1=explosion, 2=vortex, 3=rain, 4=fountain
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesOut: array<Particle>;

// Hash function for pseudo-random numbers on GPU
fn hash(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / f32(0xffffffffu);
}

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.particleCount) {
    return;
  }

  if (params.isPaused > 0.5) {
    particlesOut[index] = particlesIn[index];
    return;
  }

  var p = particlesIn[index];
  let dt = params.deltaTime * params.timeScale;

  // Apply gravity
  p.vel.y -= params.gravity * dt;

  // Mouse interaction
  if (params.mousePressed > 0.5 || params.mouseRightPressed > 0.5) {
    let mousePos = vec2<f32>(params.mouseX, params.mouseY);
    let diff = mousePos - p.pos;
    let dist = length(diff);

    if (dist < params.brushSize && dist > 0.001) {
      let dir = normalize(diff);
      let force = (1.0 - dist / params.brushSize);

      if (params.mousePressed > 0.5) {
        // Left click: attract particles
        p.vel += dir * force * 3.0 * dt;
      }
      if (params.mouseRightPressed > 0.5) {
        // Right click: repel particles
        p.vel -= dir * force * 5.0 * dt;
      }
    }
  }

  // Preset-specific behaviors
  if (params.presetMode == 2u) {
    // Vortex: apply rotational force toward center
    let center = vec2<f32>(0.0, 0.0);
    let diff = center - p.pos;
    let dist = length(diff);
    if (dist > 0.01) {
      let dir = normalize(diff);
      let tangent = vec2<f32>(-dir.y, dir.x);
      p.vel += tangent * 0.5 * dt;
      p.vel += dir * 0.1 * dt; // slight inward pull
    }
  }

  if (params.presetMode == 4u) {
    // Fountain: particles near bottom get upward boost
    if (p.pos.y < -0.8 && abs(p.pos.x) < 0.1) {
      let rng = hash(index * 7u + u32(params.deltaTime * 10000.0));
      p.vel.y += 3.0 * dt;
      p.vel.x += (rng - 0.5) * 0.5 * dt;
    }
  }

  // Apply velocity
  p.pos += p.vel * dt;

  // Velocity damping
  p.vel *= (1.0 - (1.0 - params.damping) * dt * 2.0);

  // Wall collisions with bounce
  if (p.pos.y < -1.0) {
    p.pos.y = -1.0;
    p.vel.y = abs(p.vel.y) * params.damping;
    p.vel.x *= 0.95;
  }
  if (p.pos.y > 1.0) {
    p.pos.y = 1.0;
    p.vel.y = -abs(p.vel.y) * params.damping;
  }
  if (p.pos.x < -1.0) {
    p.pos.x = -1.0;
    p.vel.x = abs(p.vel.x) * params.damping;
  }
  if (p.pos.x > 1.0) {
    p.pos.x = 1.0;
    p.vel.x = -abs(p.vel.x) * params.damping;
  }

  particlesOut[index] = p;
}
