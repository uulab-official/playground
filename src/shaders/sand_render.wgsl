// Materials: 0=empty, 1=sand, 2=water, 3=fire, 4=stone, 5=steam
struct Params {
  width: u32,
  height: u32,
  padding1: u32,
  padding2: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> grid: array<u32>;

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
    return vec4<f32>(0.05, 0.05, 0.08, 1.0);
  }

  let mat = grid[i];

  // Empty - dark background
  if (mat == 0u) { return vec4<f32>(0.05, 0.05, 0.08, 1.0); }
  // Sand - warm yellow
  if (mat == 1u) { return vec4<f32>(0.87, 0.78, 0.42, 1.0); }
  // Water - blue
  if (mat == 2u) { return vec4<f32>(0.15, 0.45, 0.85, 1.0); }
  // Fire - orange/red
  if (mat == 3u) { return vec4<f32>(1.0, 0.5, 0.1, 1.0); }
  // Stone - gray
  if (mat == 4u) { return vec4<f32>(0.45, 0.45, 0.5, 1.0); }
  // Steam - light translucent
  if (mat == 5u) { return vec4<f32>(0.7, 0.7, 0.8, 0.6); }

  return vec4<f32>(1.0, 0.0, 1.0, 1.0); // unknown = magenta
}
