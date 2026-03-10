// N-Body Galaxy Simulation - Compute Shader
// Gravitational simulation with shared memory tiling optimization

struct Body {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  mass: f32,
  brightness: f32,
  temperature: f32,
  age: f32,
};

struct Params {
  bodyCount: u32,
  deltaTime: f32,
  gravity: f32,
  softening: f32,
  damping: f32,
  mouseX: f32,
  mouseY: f32,
  mouseActive: f32,
  time: f32,
  padding1: f32,
  padding2: f32,
  padding3: f32,
};

const TILE_SIZE: u32 = 256u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> bodiesIn: array<Body>;
@group(0) @binding(2) var<storage, read_write> bodiesOut: array<Body>;

var<workgroup> tile: array<Body, 256>;

// Hash-based pseudo-random for slight perturbation
fn hash(n: u32) -> f32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return f32(x) / f32(0xffffffffu);
}

@compute @workgroup_size(256)
fn cs_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let idx = gid.x;
  if (idx >= params.bodyCount) { return; }

  let body = bodiesIn[idx];
  let dt = params.deltaTime;
  let G = params.gravity;
  let eps2 = params.softening * params.softening;

  var pos = vec2<f32>(body.x, body.y);
  var vel = vec2<f32>(body.vx, body.vy);
  let myMass = body.mass;

  // Accumulate gravitational acceleration
  var acc = vec2<f32>(0.0, 0.0);

  // Number of full tiles needed
  let numTiles = (params.bodyCount + TILE_SIZE - 1u) / TILE_SIZE;

  for (var t = 0u; t < numTiles; t++) {
    // Collaboratively load a tile of bodies into shared memory
    let loadIdx = t * TILE_SIZE + lid.x;
    if (loadIdx < params.bodyCount) {
      tile[lid.x] = bodiesIn[loadIdx];
    } else {
      // Zero out so we don't get garbage forces
      tile[lid.x].x = 0.0;
      tile[lid.x].y = 0.0;
      tile[lid.x].mass = 0.0;
    }

    workgroupBarrier();

    // Compute forces from all bodies in this tile
    let tileEnd = min(TILE_SIZE, params.bodyCount - t * TILE_SIZE);
    for (var j = 0u; j < tileEnd; j++) {
      let globalJ = t * TILE_SIZE + j;
      if (globalJ == idx) { continue; }

      let other = tile[j];
      let otherPos = vec2<f32>(other.x, other.y);
      let diff = otherPos - pos;
      let distSq = dot(diff, diff) + eps2;

      // Softened gravitational force: F = G * m / (r^2 + eps^2)^1.5
      let invDist = 1.0 / sqrt(distSq);
      let invDist3 = invDist * invDist * invDist;

      acc += diff * (G * other.mass * invDist3);
    }

    workgroupBarrier();
  }

  // Mouse attractor: creates a massive gravitational well
  if (params.mouseActive > 0.5) {
    let mousePos = vec2<f32>(params.mouseX, params.mouseY);
    let diff = mousePos - pos;
    let distSq = dot(diff, diff) + eps2;
    let invDist = 1.0 / sqrt(distSq);
    let invDist3 = invDist * invDist * invDist;
    // Massive attractor mass
    let attractorMass = 500.0;
    acc += diff * (G * attractorMass * invDist3);
  }

  // --- Velocity Verlet integration ---
  // v(t + dt/2) = v(t) + a(t) * dt/2
  let velHalf = vel + acc * (dt * 0.5);

  // x(t + dt) = x(t) + v(t + dt/2) * dt
  var newPos = pos + velHalf * dt;

  // For full Verlet we'd recompute acceleration at new position,
  // but that doubles cost. Use kick-drift-kick approximation:
  // v(t + dt) = v(t + dt/2) + a(t) * dt/2
  var newVel = velHalf + acc * (dt * 0.5);

  // Apply damping to slowly bleed kinetic energy (prevents runaway)
  newVel *= params.damping;

  // --- Boundary handling: soft boundary push ---
  let boundary = 1.2;
  let pushStrength = 2.0;
  // Smooth push when approaching boundary
  if (newPos.x > boundary) {
    newVel.x -= pushStrength * (newPos.x - boundary) * dt;
  }
  if (newPos.x < -boundary) {
    newVel.x -= pushStrength * (newPos.x + boundary) * dt;
  }
  if (newPos.y > boundary) {
    newVel.y -= pushStrength * (newPos.y - boundary) * dt;
  }
  if (newPos.y < -boundary) {
    newVel.y -= pushStrength * (newPos.y + boundary) * dt;
  }

  // Hard wrap as safety net
  let hardBound = 1.5;
  if (newPos.x > hardBound) { newPos.x -= 2.0 * hardBound; }
  if (newPos.x < -hardBound) { newPos.x += 2.0 * hardBound; }
  if (newPos.y > hardBound) { newPos.y -= 2.0 * hardBound; }
  if (newPos.y < -hardBound) { newPos.y += 2.0 * hardBound; }

  // --- Temperature evolution ---
  // Based on velocity: fast bodies are hot (blue/white), slow are cool (red)
  let speed = length(newVel);
  // Target temperature mapped from speed
  // speed ~0 -> temp ~1000K (red), speed ~2+ -> temp ~30000K (blue-white)
  let targetTemp = clamp(1000.0 + speed * 14000.0, 800.0, 40000.0);
  // Smooth transition: temperature changes gradually
  let tempRate = 0.5 * dt;
  let newTemp = mix(body.temperature, targetTemp, clamp(tempRate, 0.0, 1.0));

  // --- Brightness evolution ---
  // Brightness flickers based on interactions
  let accelMag = length(acc);
  let baseBrightness = 0.5 + myMass * 0.3;
  // Boost brightness during close encounters
  let interactionBoost = clamp(accelMag * 0.01, 0.0, 0.5);
  let targetBrightness = clamp(baseBrightness + interactionBoost, 0.3, 1.0);
  let newBrightness = mix(body.brightness, targetBrightness, clamp(2.0 * dt, 0.0, 1.0));

  // --- Age ---
  let newAge = body.age + dt;

  // Write output
  var out: Body;
  out.x = newPos.x;
  out.y = newPos.y;
  out.vx = newVel.x;
  out.vy = newVel.y;
  out.mass = myMass;
  out.brightness = newBrightness;
  out.temperature = newTemp;
  out.age = newAge;

  bodiesOut[idx] = out;
}
