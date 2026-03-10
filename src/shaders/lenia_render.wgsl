struct Params { width: u32, height: u32, colorMode: u32, pad: u32 }

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> grid: array<f32>;

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

fn viridis(t: f32) -> vec3<f32> {
  // Approximate viridis colormap
  let c0 = vec3<f32>(0.267, 0.005, 0.329);
  let c1 = vec3<f32>(0.190, 0.407, 0.556);
  let c2 = vec3<f32>(0.128, 0.566, 0.551);
  let c3 = vec3<f32>(0.369, 0.714, 0.427);
  let c4 = vec3<f32>(0.993, 0.906, 0.144);
  let s = clamp(t, 0.0, 1.0) * 4.0;
  let i = floor(s);
  let f = fract(s);
  var a: vec3<f32>; var b: vec3<f32>;
  switch u32(i) {
    case 0u: { a = c0; b = c1; }
    case 1u: { a = c1; b = c2; }
    case 2u: { a = c2; b = c3; }
    default: { a = c3; b = c4; }
  }
  return mix(a, b, f);
}

fn alienColor(v: f32) -> vec3<f32> {
  // Deep space alien: dark background, cyan/green glow
  let glow = v * v;
  return vec3<f32>(glow * 0.1, glow * 0.9, glow * 0.5 + v * 0.3);
}

fn goldColor(v: f32) -> vec3<f32> {
  let t = v;
  return mix(vec3<f32>(0.05, 0.02, 0.0), vec3<f32>(1.0, 0.85, 0.2), t * t);
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let ix = clamp(u32(in.uv.x * f32(p.width)),  0u, p.width  - 1u);
  let iy = clamp(u32(in.uv.y * f32(p.height)), 0u, p.height - 1u);
  let v = grid[iy * p.width + ix];

  var color: vec3<f32>;
  switch p.colorMode {
    case 1u: { color = alienColor(v); }
    case 2u: { color = goldColor(v); }
    default: { color = viridis(v); }
  }
  return vec4<f32>(color, 1.0);
}
