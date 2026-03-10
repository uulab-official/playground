// Body struct: 32 bytes
// x: f32, y: f32, vx: f32, vy: f32, mass: f32, pad1: f32, pad2: f32, pad3: f32

// Params struct: 32 bytes
// [0] bodyCount: u32
// [1] dt: f32
// [2] G: f32
// [3] softening: f32
// [4] damping: f32
// [5..7] pad: u32 x3

struct Body {
  x: f32, y: f32, vx: f32, vy: f32,
  mass: f32, pad1: f32, pad2: f32, pad3: f32,
}

struct Params {
  bodyCount: u32, dt: f32, G: f32, softening: f32,
  damping: f32, pad1: u32, pad2: u32, pad3: u32,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> bodiesIn: array<Body>;
@group(0) @binding(2) var<storage, read_write> bodiesOut: array<Body>;

var<workgroup> sharedBodies: array<Body, 64>;

@compute @workgroup_size(64)
fn cs_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id)  lid: vec3<u32>,
  @builtin(workgroup_id)         wgid: vec3<u32>,
) {
  let i = gid.x;
  if (i >= p.bodyCount) { return; }

  let bi = bodiesIn[i];
  var ax = 0.0; var ay = 0.0;

  let numTiles = (p.bodyCount + 63u) / 64u;
  for (var tile = 0u; tile < numTiles; tile++) {
    let j = tile * 64u + lid.x;
    sharedBodies[lid.x] = select(bodiesIn[j], Body(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0), j >= p.bodyCount);
    workgroupBarrier();

    for (var k = 0u; k < 64u; k++) {
      let bk = sharedBodies[k];
      if (tile * 64u + k == i || bk.mass == 0.0) { continue; }
      let dx = bk.x - bi.x;
      let dy = bk.y - bi.y;
      let dist2 = dx*dx + dy*dy + p.softening * p.softening;
      let invDist = 1.0 / sqrt(dist2);
      let invDist3 = invDist * invDist * invDist;
      ax += p.G * bk.mass * dx * invDist3;
      ay += p.G * bk.mass * dy * invDist3;
    }
    workgroupBarrier();
  }

  var bo: Body;
  bo.vx = (bi.vx + ax * p.dt) * p.damping;
  bo.vy = (bi.vy + ay * p.dt) * p.damping;
  bo.x  = bi.x + bo.vx * p.dt;
  bo.y  = bi.y + bo.vy * p.dt;
  bo.mass = bi.mass;
  bo.pad1 = 0.0; bo.pad2 = 0.0; bo.pad3 = 0.0;

  // Soft boundary push
  let r = sqrt(bo.x*bo.x + bo.y*bo.y);
  if (r > 0.95) {
    let overshoot = r - 0.95;
    bo.vx -= (bo.x / r) * overshoot * 0.5;
    bo.vy -= (bo.y / r) * overshoot * 0.5;
  }

  bodiesOut[i] = bo;
}
