// Physarum — fullscreen quad render shader
struct Params {
  width:     u32,  // [0]
  height:    u32,  // [1]
  colorMode: u32,  // [2]  0=Slime, 1=Plasma, 2=Fire
  pad:       u32,  // [3]
};

@group(0) @binding(0) var<uniform>  params:   Params;
@group(0) @binding(1) var<storage, read> trailMap: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vid], 0.0, 1.0);
  out.uv = (pos[vid] + 1.0) * 0.5;
  return out;
}

// Hue-Saturation-Value → RGB
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c = v * s;
  let hh = (h * 6.0) % 6.0;
  let x = c * (1.0 - abs(hh % 2.0 - 1.0));
  var rgb: vec3<f32>;
  if      (hh < 1.0) { rgb = vec3<f32>(c, x, 0.0); }
  else if (hh < 2.0) { rgb = vec3<f32>(x, c, 0.0); }
  else if (hh < 3.0) { rgb = vec3<f32>(0.0, c, x); }
  else if (hh < 4.0) { rgb = vec3<f32>(0.0, x, c); }
  else if (hh < 5.0) { rgb = vec3<f32>(x, 0.0, c); }
  else               { rgb = vec3<f32>(c, 0.0, x); }
  let m = v - c;
  return rgb + vec3<f32>(m, m, m);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let x = u32(uv.x * f32(params.width));
  let y = u32(uv.y * f32(params.height));
  let i = y * params.width + x;

  if (i >= params.width * params.height) {
    return vec4<f32>(0.0, 0.0, 0.02, 1.0);
  }

  let raw = trailMap[i];
  let t   = clamp(f32(raw) / 1000.0, 0.0, 1.0);

  if (t <= 0.0) {
    return vec4<f32>(0.0, 0.0, 0.02, 1.0);
  }

  let mode = params.colorMode;

  // 0 — Slime: green-yellow on dark background
  if (mode == 0u) {
    let hue = 0.3 - t * 0.1;
    let col = hsv2rgb(hue, 0.8, t);
    return vec4<f32>(col, 1.0);
  }

  // 1 — Plasma: blue → magenta
  if (mode == 1u) {
    let hue = 0.6 + t * 0.4;
    let col = hsv2rgb(hue, 0.9, t * 0.95 + 0.05);
    return vec4<f32>(col, 1.0);
  }

  // 2 — Fire: dark red → orange → bright white-yellow
  let fire = mix(vec3<f32>(0.6, 0.05, 0.0), vec3<f32>(1.0, 1.0, 0.85), t);
  return vec4<f32>(fire, 1.0);
}
