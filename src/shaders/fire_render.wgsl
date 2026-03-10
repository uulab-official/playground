// Render params (16 bytes):
// [0] width: u32
// [1] height: u32
// [2] colorMode: u32   (0=Fire, 1=Plasma, 2=Ice)
// [3] pad: u32

struct Params { width: u32, height: u32, colorMode: u32, pad: u32 }

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> heatMap: array<f32>;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex fn vs_main(@builtin(vertex_index) vid: u32) -> VOut {
  var positions = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
  );
  var uvs = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0),
  );
  return VOut(vec4<f32>(positions[vid], 0.0, 1.0), uvs[vid]);
}

fn fireColor(t: f32) -> vec3<f32> {
  let r = clamp(t * 3.0, 0.0, 1.0);
  let g = clamp(t * 3.0 - 1.0, 0.0, 1.0);
  let b = clamp(t * 3.0 - 2.0, 0.0, 1.0);
  return vec3<f32>(r, g, b);
}

fn plasmaColor(t: f32) -> vec3<f32> {
  let pi2 = 6.2831853;
  return vec3<f32>(
    0.5 + 0.5 * sin(t * pi2),
    0.5 + 0.5 * sin(t * pi2 + 2.094),
    0.5 + 0.5 * sin(t * pi2 + 4.189),
  );
}

fn iceColor(t: f32) -> vec3<f32> {
  return mix(vec3<f32>(0.0, 0.02, 0.18), vec3<f32>(0.5, 0.85, 1.0), t);
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let ix = clamp(u32(in.uv.x * f32(p.width)),  0u, p.width  - 1u);
  let iy = clamp(u32(in.uv.y * f32(p.height)), 0u, p.height - 1u);
  let heat = heatMap[iy * p.width + ix];

  var color: vec3<f32>;
  switch p.colorMode {
    case 1u: { color = plasmaColor(heat); }
    case 2u: { color = iceColor(heat); }
    default: { color = fireColor(heat); }
  }
  return vec4<f32>(color, 1.0);
}
