// Physarum — trail diffusion and decay compute shader
struct TrailParams {
  width:   u32,  // [0]
  height:  u32,  // [1]
  decay:   f32,  // [2]
  diffuse: f32,  // [3] (reserved / padding)
};

@group(0) @binding(0) var<uniform>             params:   TrailParams;
@group(0) @binding(1) var<storage, read_write> trailIn:  array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> trailOut: array<u32>;

fn readTrail(tx: i32, ty: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  if (tx < 0 || tx >= w || ty < 0 || ty >= h) {
    return 0.0;
  }
  let v = atomicLoad(&trailIn[u32(ty) * params.width + u32(tx)]);
  return f32(v);
}

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (u32(x) >= params.width || u32(y) >= params.height) { return; }

  // 3×3 box blur (simple uniform average)
  let c  = readTrail(x,     y    );
  let n  = readTrail(x,     y - 1);
  let s  = readTrail(x,     y + 1);
  let w  = readTrail(x - 1, y    );
  let e  = readTrail(x + 1, y    );
  let nw = readTrail(x - 1, y - 1);
  let ne = readTrail(x + 1, y - 1);
  let sw = readTrail(x - 1, y + 1);
  let se = readTrail(x + 1, y + 1);

  let blurred = (c + n + s + w + e + nw + ne + sw + se) / 9.0;
  let decayed = blurred * params.decay;

  // Cap at 1000000 raw units (= 1000.0 normalised)
  let result = u32(clamp(decayed, 0.0, 1000000.0));
  trailOut[u32(y) * params.width + u32(x)] = result;
}
