struct Params {
  width: u32, height: u32,
  radius: f32, mu: f32, sigma: f32, dt: f32,
  mouseX: f32, mouseY: f32,
  mouseActive: u32, brushSize: u32,
  pad1: u32, pad2: u32,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> gridIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> gridOut: array<f32>;

fn kernelWeight(r: f32) -> f32 {
  if (r >= p.radius || r < 0.001) { return 0.0; }
  let rn = r / p.radius;
  return exp(-4.0 * pow((rn - 0.5) / 0.5, 2.0));
}

fn growth(u: f32) -> f32 {
  let s = max(p.sigma, 0.001);
  return 2.0 * exp(-((u - p.mu) * (u - p.mu)) / (2.0 * s * s)) - 1.0;
}

fn getCell(x: i32, y: i32) -> f32 {
  // Toroidal wrapping
  let cx = ((x % i32(p.width)) + i32(p.width)) % i32(p.width);
  let cy = ((y % i32(p.height)) + i32(p.height)) % i32(p.height);
  return gridIn[u32(cy) * p.width + u32(cx)];
}

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.width || gid.y >= p.height) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let cell = gid.y * p.width + gid.x;

  let R = i32(ceil(p.radius));
  var convSum = 0.0;
  var weightSum = 0.0;

  for (var dy = -R; dy <= R; dy++) {
    for (var dx = -R; dx <= R; dx++) {
      let r = sqrt(f32(dx * dx + dy * dy));
      let k = kernelWeight(r);
      if (k > 0.001) {
        convSum += k * getCell(x + dx, y + dy);
        weightSum += k;
      }
    }
  }

  let U = select(0.0, convSum / weightSum, weightSum > 0.001);
  let G = growth(U);
  var val = getCell(x, y) + p.dt * G;

  // Mouse: paint living cells
  if (p.mouseActive == 1u) {
    let mx = i32(p.mouseX * f32(p.width));
    let my = i32(p.mouseY * f32(p.height));
    let d = abs(x - mx) + abs(y - my);
    if (d < i32(p.brushSize)) { val = 1.0; }
  }

  gridOut[cell] = clamp(val, 0.0, 1.0);
}
