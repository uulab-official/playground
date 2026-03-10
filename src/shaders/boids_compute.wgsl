struct Boid {
  pos: vec2<f32>,
  vel: vec2<f32>,
};

struct Params {
  deltaTime: f32,
  separationDist: f32,
  alignmentDist: f32,
  cohesionDist: f32,
  separationForce: f32,
  alignmentForce: f32,
  cohesionForce: f32,
  maxSpeed: f32,
  boidCount: u32,
  mouseX: f32,
  mouseY: f32,
  mousePressed: f32,
  isPaused: f32,
  padding1: f32,
  padding2: f32,
  padding3: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> boidsIn: array<Boid>;
@group(0) @binding(2) var<storage, read_write> boidsOut: array<Boid>;

@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.boidCount) { return; }

  if (params.isPaused > 0.5) {
    boidsOut[idx] = boidsIn[idx];
    return;
  }

  var boid = boidsIn[idx];
  let dt = params.deltaTime;

  // Flocking forces
  var separation = vec2<f32>(0.0);
  var alignment = vec2<f32>(0.0);
  var cohesion = vec2<f32>(0.0);
  var sepCount = 0u;
  var aliCount = 0u;
  var cohCount = 0u;

  for (var i = 0u; i < params.boidCount; i++) {
    if (i == idx) { continue; }
    let other = boidsIn[i];
    let diff = boid.pos - other.pos;
    let dist = length(diff);

    // Separation
    if (dist < params.separationDist && dist > 0.001) {
      separation += normalize(diff) / dist;
      sepCount += 1u;
    }
    // Alignment
    if (dist < params.alignmentDist) {
      alignment += other.vel;
      aliCount += 1u;
    }
    // Cohesion
    if (dist < params.cohesionDist) {
      cohesion += other.pos;
      cohCount += 1u;
    }
  }

  var steer = vec2<f32>(0.0);

  if (sepCount > 0u) {
    separation /= f32(sepCount);
    steer += normalize(separation) * params.separationForce;
  }
  if (aliCount > 0u) {
    alignment /= f32(aliCount);
    let desired = normalize(alignment) * params.maxSpeed;
    steer += (desired - boid.vel) * params.alignmentForce;
  }
  if (cohCount > 0u) {
    cohesion /= f32(cohCount);
    let desired = normalize(cohesion - boid.pos) * params.maxSpeed;
    steer += (desired - boid.vel) * params.cohesionForce;
  }

  // Mouse interaction - flee or attract
  if (params.mousePressed > 0.5) {
    let mousePos = vec2<f32>(params.mouseX, params.mouseY);
    let diff = boid.pos - mousePos;
    let dist = length(diff);
    if (dist < 0.3 && dist > 0.001) {
      steer += normalize(diff) * 2.0 / dist;
    }
  }

  boid.vel += steer * dt;

  // Limit speed
  let speed = length(boid.vel);
  if (speed > params.maxSpeed) {
    boid.vel = normalize(boid.vel) * params.maxSpeed;
  }
  // Minimum speed
  if (speed < params.maxSpeed * 0.3) {
    boid.vel = normalize(boid.vel + vec2<f32>(0.001, 0.0)) * params.maxSpeed * 0.3;
  }

  boid.pos += boid.vel * dt;

  // Wrap around edges
  if (boid.pos.x < -1.0) { boid.pos.x += 2.0; }
  if (boid.pos.x > 1.0) { boid.pos.x -= 2.0; }
  if (boid.pos.y < -1.0) { boid.pos.y += 2.0; }
  if (boid.pos.y > 1.0) { boid.pos.y -= 2.0; }

  boidsOut[idx] = boid;
}
