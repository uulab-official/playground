struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
};

struct SimulationParams {
  deltaTime: f32,
  gravity: f32,
  damping: f32,
  canvasWidth: f32, // Used for boundaries if coordinates are pixel-based
  canvasHeight: f32,
  isPaused: f32, // 1.0 = paused, 0.0 = running
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> params: SimulationParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
  let index = GlobalInvocationID.x;
  if (index >= arrayLength(&particles)) {
    return;
  }

  if (params.isPaused > 0.5) {
      return;
  }

  var p = particles[index];
  
  let dt = params.deltaTime;
  
  // Apply Gravity
  p.vel.y -= params.gravity * dt; // Assuming Y up is 1.0, NDC y goes from -1(bottom) to 1(top)
  
  // Apply velocity to position
  p.pos += p.vel * dt;

  // Simple floor collision (NDC y = -1.0)
  if (p.pos.y < -1.0) {
    p.pos.y = -1.0;
    p.vel.y = -p.vel.y * params.damping;
    p.vel.x *= 0.95; // floor friction
  }
  
  // Simple wall collision (NDC x = -1.0, 1.0)
  if (p.pos.x < -1.0) {
      p.pos.x = -1.0;
      p.vel.x = -p.vel.x * params.damping;
  }
  if (p.pos.x > 1.0) {
      p.pos.x = 1.0;
      p.vel.x = -p.vel.x * params.damping;
  }
  if (p.pos.y > 1.0) {
      p.pos.y = 1.0;
      p.vel.y = -p.vel.y * params.damping;
  }

  particles[index] = p;
}
