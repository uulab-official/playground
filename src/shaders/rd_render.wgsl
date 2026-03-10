struct Params {
  width: u32,
  height: u32,
  colorMode: u32,
  padding: u32,
};

struct Cell {
  a: f32,
  b: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> grid: array<Cell>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vid], 0.0, 1.0);
  out.uv = (pos[vid] + 1.0) * 0.5;
  return out;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let x = u32(uv.x * f32(params.width));
  let y = u32((1.0 - uv.y) * f32(params.height));
  let i = y * params.width + x;
  if (i >= params.width * params.height) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let cell = grid[i];
  let a = cell.a;
  let b = cell.b;
  let v = a - b;

  let mode = params.colorMode;

  // Organic teal/coral
  if (mode == 0u) {
    let r = clamp(v * 0.3 + b * 0.8, 0.0, 1.0);
    let g = clamp(v * 0.8, 0.0, 1.0);
    let bl = clamp(v * 1.2 - b * 0.3, 0.0, 1.0);
    return vec4<f32>(r * 0.6, g * 0.85, bl, 1.0);
  }

  // Purple/gold
  if (mode == 1u) {
    let r = clamp(b * 1.5, 0.0, 1.0);
    let g = clamp(b * 0.4, 0.0, 1.0);
    let bl = clamp(v * 0.9, 0.0, 1.0);
    return vec4<f32>(r * 0.8, g, bl * 0.9, 1.0);
  }

  // Grayscale
  if (mode == 2u) {
    let c = clamp(v, 0.0, 1.0);
    return vec4<f32>(c, c, c, 1.0);
  }

  // Infrared
  let r2 = clamp(b * 2.0, 0.0, 1.0);
  let g2 = clamp(v * 0.5, 0.0, 1.0);
  let b2 = clamp(v * 0.2, 0.0, 1.0);
  return vec4<f32>(r2, g2, b2, 1.0);
}
