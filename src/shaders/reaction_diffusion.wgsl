// Gray-Scott Reaction-Diffusion compute shader
struct Params {
  width: u32,
  height: u32,
  feed: f32,
  kill: f32,
  dA: f32,      // diffusion rate A
  dB: f32,      // diffusion rate B
  dt: f32,
  isPaused: u32,
  mouseX: f32,
  mouseY: f32,
  mousePressed: u32,
  brushSize: u32,
};

struct Cell {
  a: f32,
  b: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gridIn: array<Cell>;
@group(0) @binding(2) var<storage, read_write> gridOut: array<Cell>;

fn idx(x: i32, y: i32) -> u32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let wx = ((x % w) + w) % w;
  let wy = ((y % h) + h) % h;
  return u32(wy) * params.width + u32(wx);
}

fn laplacian(x: i32, y: i32) -> Cell {
  // 3x3 convolution kernel
  let c = gridIn[idx(x, y)];
  let t = gridIn[idx(x, y - 1)];
  let b = gridIn[idx(x, y + 1)];
  let l = gridIn[idx(x - 1, y)];
  let r = gridIn[idx(x + 1, y)];
  let tl = gridIn[idx(x - 1, y - 1)];
  let tr = gridIn[idx(x + 1, y - 1)];
  let bl = gridIn[idx(x - 1, y + 1)];
  let br = gridIn[idx(x + 1, y + 1)];

  var lap: Cell;
  lap.a = -c.a
    + (t.a + b.a + l.a + r.a) * 0.2
    + (tl.a + tr.a + bl.a + br.a) * 0.05;
  lap.b = -c.b
    + (t.b + b.b + l.b + r.b) * 0.2
    + (tl.b + tr.b + bl.b + br.b) * 0.05;
  return lap;
}

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }

  let i = y * params.width + x;

  if (params.isPaused > 0u) {
    gridOut[i] = gridIn[i];
    return;
  }

  let cell = gridIn[i];
  let lap = laplacian(i32(x), i32(y));

  let a = cell.a;
  let b = cell.b;
  let abb = a * b * b;

  var newA = a + (params.dA * lap.a - abb + params.feed * (1.0 - a)) * params.dt;
  var newB = b + (params.dB * lap.b + abb - (params.kill + params.feed) * b) * params.dt;

  newA = clamp(newA, 0.0, 1.0);
  newB = clamp(newB, 0.0, 1.0);

  // Mouse seed: add chemical B at cursor
  if (params.mousePressed > 0u) {
    let mx = i32(params.mouseX * f32(params.width));
    let my = i32(params.mouseY * f32(params.height));
    let dx = i32(x) - mx;
    let dy = i32(y) - my;
    let dist = dx * dx + dy * dy;
    let bs = i32(params.brushSize);
    if (dist < bs * bs) {
      newB = 1.0;
    }
  }

  gridOut[i] = Cell(newA, newB);
}
