struct Params {
  center: vec2<f32>,       // Pan center
  zoom: f32,               // Zoom level
  maxIter: f32,            // Max iterations
  juliaReal: f32,          // Julia constant real
  juliaImag: f32,          // Julia constant imaginary
  isJulia: f32,            // 0 = Mandelbrot, 1 = Julia
  time: f32,               // Animation time
  aspectRatio: f32,
  colorMode: f32,          // 0=classic, 1=fire, 2=ocean, 3=neon
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> params: Params;

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
  output.uv = positions[vid];
  return output;
}

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c = v * s;
  let x = c * (1.0 - abs(((h * 6.0) % 2.0) - 1.0));
  let m = v - c;
  var rgb: vec3<f32>;
  let hi = u32(h * 6.0) % 6u;
  if (hi == 0u) { rgb = vec3<f32>(c, x, 0.0); }
  else if (hi == 1u) { rgb = vec3<f32>(x, c, 0.0); }
  else if (hi == 2u) { rgb = vec3<f32>(0.0, c, x); }
  else if (hi == 3u) { rgb = vec3<f32>(0.0, x, c); }
  else if (hi == 4u) { rgb = vec3<f32>(x, 0.0, c); }
  else { rgb = vec3<f32>(c, 0.0, x); }
  return rgb + vec3<f32>(m);
}

fn colorize(t: f32, mode: f32) -> vec3<f32> {
  let m = u32(mode);

  // Classic rainbow
  if (m == 0u) {
    return hsv2rgb(t, 0.85, 1.0);
  }
  // Fire
  if (m == 1u) {
    let r = clamp(t * 3.0, 0.0, 1.0);
    let g = clamp(t * 3.0 - 1.0, 0.0, 1.0);
    let b = clamp(t * 3.0 - 2.0, 0.0, 1.0);
    return vec3<f32>(r, g * 0.7, b * 0.3);
  }
  // Ocean
  if (m == 2u) {
    return mix(
      mix(vec3<f32>(0.0, 0.02, 0.15), vec3<f32>(0.0, 0.4, 0.8), t),
      vec3<f32>(0.9, 1.0, 1.0),
      t * t
    );
  }
  // Neon
  return hsv2rgb(t * 0.8 + 0.7, 1.0, 0.5 + t * 0.5);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let scale = 1.0 / params.zoom;
  var c: vec2<f32>;
  var z: vec2<f32>;

  let coord = vec2<f32>(uv.x * params.aspectRatio, uv.y) * scale + params.center;

  if (params.isJulia > 0.5) {
    z = coord;
    c = vec2<f32>(params.juliaReal, params.juliaImag);
  } else {
    z = vec2<f32>(0.0);
    c = coord;
  }

  var iter = 0.0;
  let maxIter = params.maxIter;

  for (var i = 0.0; i < 1000.0; i += 1.0) {
    if (i >= maxIter) { break; }
    let zNew = vec2<f32>(
      z.x * z.x - z.y * z.y + c.x,
      2.0 * z.x * z.y + c.y
    );
    z = zNew;
    if (dot(z, z) > 256.0) { break; }
    iter += 1.0;
  }

  if (iter >= maxIter) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  // Smooth coloring
  let logZn = log(dot(z, z)) / 2.0;
  let nu = log(logZn / log(2.0)) / log(2.0);
  let smoothIter = iter + 1.0 - nu;
  let t = fract(smoothIter * 0.02 + params.time * 0.05);

  let col = colorize(t, params.colorMode);
  return vec4<f32>(col, 1.0);
}
