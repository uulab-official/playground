// Params layout (32 bytes):
// [0] width: u32
// [1] height: u32
// [2] cooling: f32    (0.93..0.99, lower = hotter)
// [3] turbulence: f32 (0.5..4.0, wind randomness)
// [4] mouseX: f32     (0..1 normalized, no Y flip)
// [5] mouseY: f32     (0..1 normalized, no Y flip)
// [6] mouseActive: u32
// [7] frame: u32

struct Params {
  width: u32, height: u32,
  cooling: f32, turbulence: f32,
  mouseX: f32, mouseY: f32,
  mouseActive: u32, frame: u32,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> heatIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> heatOut: array<f32>;

fn hash(n: u32) -> f32 {
  var x = n;
  x = x ^ (x >> 17u);
  x = x * 0xbf324c81u;
  x = x ^ (x >> 11u);
  x = x * 0x9c7493adu;
  x = x ^ (x >> 15u);
  return f32(x) / f32(0xffffffffu);
}

fn getHeat(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(p.width) - 1);
  let cy = clamp(y, 0, i32(p.height) - 1);
  return heatIn[u32(cy) * p.width + u32(cx)];
}

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.width || gid.y >= p.height) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let cell = gid.y * p.width + gid.x;

  // Bottom row of screen (y = height-1) is the heat source
  if (gid.y == p.height - 1u) {
    let rng = hash(gid.x + p.frame * 7919u);
    heatOut[cell] = select(0.85 + rng * 0.15, 0.0, rng < 0.08);
    return;
  }

  // Fire rises upward = toward lower y. Sample from y+1 (below on screen).
  let seed = gid.x * 1973u + gid.y * 9277u + p.frame * 26699u;
  let rng = hash(seed);
  let dx = i32(round((rng - 0.5) * p.turbulence));

  let h0 = getHeat(x + dx,     y + 1);
  let h1 = getHeat(x + dx - 1, y + 1);
  let h2 = getHeat(x + dx + 1, y + 1);
  let h3 = getHeat(x + dx,     y + 2);

  var heat = (h0 + h1 + h2 + h3) * 0.25 * p.cooling;

  // Mouse: add heat at cursor position
  if (p.mouseActive == 1u) {
    let mx = i32(p.mouseX * f32(p.width));
    let my = i32(p.mouseY * f32(p.height));
    let d = max(abs(x - mx), abs(y - my));
    if (d < 18) { heat = min(heat + 0.9, 1.0); }
  }

  heatOut[cell] = clamp(heat, 0.0, 1.0);
}
