struct Params {
  width: u32,
  height: u32,
  colorMode: u32,
  padding: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cells: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vid], 0.0, 1.0);
  output.uv = (positions[vid] + 1.0) * 0.5; // 0..1
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let x = u32(uv.x * f32(params.width));
  let y = u32((1.0 - uv.y) * f32(params.height)); // Flip Y
  let idx = y * params.width + x;

  if (idx >= params.width * params.height) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let alive = cells[idx];

  if (alive == 0u) {
    return vec4<f32>(0.03, 0.03, 0.05, 1.0);
  }

  // Color modes
  let mode = params.colorMode;
  if (mode == 0u) {
    // Matrix green
    return vec4<f32>(0.1, 0.95, 0.3, 1.0);
  }
  if (mode == 1u) {
    // Indigo glow
    return vec4<f32>(0.4, 0.3, 1.0, 1.0);
  }
  if (mode == 2u) {
    // Amber
    return vec4<f32>(1.0, 0.75, 0.1, 1.0);
  }
  // Cyan
  return vec4<f32>(0.1, 0.9, 0.95, 1.0);
}
