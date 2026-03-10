// Particle Life — GPU Compute (species-based attraction/repulsion)

struct Particle {
  x:       f32,
  y:       f32,
  vx:      f32,
  vy:      f32,
  species: u32,
  pad1:    u32,
  pad2:    u32,
  pad3:    u32,
};

struct Params {
  particleCount:  u32,
  dt:             f32,
  friction:       f32,
  rMax:           f32,
  forceMagnitude: f32,
  pad1:           f32,
  pad2:           f32,
  pad3:           f32,
  forceMatrix:    array<vec4<f32>, 9>,
};

@group(0) @binding(0) var<uniform>             params:       Params;
@group(0) @binding(1) var<storage, read>       particlesIn:  array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesOut: array<Particle>;

var<workgroup> tile: array<Particle, 64>;

// Read force value at flat index i from the packed forceMatrix (9 vec4s)
fn getForceValue(i: u32) -> f32 {
  let vi = i / 4u;
  let ci = i % 4u;
  var v: vec4<f32>;
  switch (vi) {
    case 0u: { v = params.forceMatrix[0]; }
    case 1u: { v = params.forceMatrix[1]; }
    case 2u: { v = params.forceMatrix[2]; }
    case 3u: { v = params.forceMatrix[3]; }
    case 4u: { v = params.forceMatrix[4]; }
    case 5u: { v = params.forceMatrix[5]; }
    case 6u: { v = params.forceMatrix[6]; }
    case 7u: { v = params.forceMatrix[7]; }
    default: { v = params.forceMatrix[8]; }
  }
  switch (ci) {
    case 0u: { return v.x; }
    case 1u: { return v.y; }
    case 2u: { return v.z; }
    default: { return v.w; }
  }
}

// Piecewise linear force:
//   r < beta:  repulsion zone, f = r/beta - 1  (ranges -1..0)
//   beta <= r < 1: species-dependent, triangle peak at midpoint
//   r >= 1:    no force
fn forceFunc(r: f32, attraction: f32) -> f32 {
  let beta = 0.3;
  if (r < beta) {
    return r / beta - 1.0;
  } else if (r < 1.0) {
    // Normalised distance in [0,1] over the attraction band
    let t = (r - beta) / (1.0 - beta);
    // Triangle: peak at t=0.5
    return attraction * (1.0 - abs(2.0 * t - 1.0));
  }
  return 0.0;
}

// Shortest-path distance on wrapped [0,1] torus
fn wrappedDelta(a: f32, b: f32) -> f32 {
  var d = b - a;
  if (d > 0.5)  { d -= 1.0; }
  if (d < -0.5) { d += 1.0; }
  return d;
}

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id)  lid: vec3<u32>,
) {
  let i = gid.x;
  let li = lid.x;
  let n = params.particleCount;

  var ax = 0.0;
  var ay = 0.0;

  var pi: Particle;
  var validI = false;
  if (i < n) {
    pi = particlesIn[i];
    validI = true;
  }

  // Tile-based O(N²) force accumulation
  let numTiles = (n + 63u) / 64u;
  for (var t = 0u; t < numTiles; t++) {
    // Load tile into shared memory
    let j = t * 64u + li;
    if (j < n) {
      tile[li] = particlesIn[j];
    }
    workgroupBarrier();

    if (validI) {
      let tileEnd = min(64u, n - t * 64u);
      for (var k = 0u; k < tileEnd; k++) {
        let j_global = t * 64u + k;
        if (j_global == i) { continue; }

        let pj = tile[k];
        let dx = wrappedDelta(pi.x, pj.x);
        let dy = wrappedDelta(pi.y, pj.y);
        let dist = sqrt(dx * dx + dy * dy);

        let rNorm = dist / params.rMax;
        if (rNorm < 1.0 && dist > 0.0001) {
          let si = pi.species;
          let sj = pj.species;
          let matIdx = si * 6u + sj;
          let attraction = getForceValue(matIdx);
          let f = forceFunc(rNorm, attraction) * params.forceMagnitude;
          let invDist = 1.0 / dist;
          ax += f * dx * invDist;
          ay += f * dy * invDist;
        }
      }
    }

    workgroupBarrier();
  }

  if (!validI) { return; }

  var vx = pi.vx * params.friction + ax * params.dt;
  var vy = pi.vy * params.friction + ay * params.dt;

  // Clamp max speed
  let speed = sqrt(vx * vx + vy * vy);
  let maxSpeed = 0.003;
  if (speed > maxSpeed) {
    let s = maxSpeed / speed;
    vx *= s;
    vy *= s;
  }

  // Integrate position with wrap-around (fract for [0,1])
  let nx = fract(pi.x + vx * params.dt);
  let ny = fract(pi.y + vy * params.dt);

  particlesOut[i] = Particle(nx, ny, vx, vy, pi.species, 0u, 0u, 0u);
}
