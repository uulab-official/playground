// Voronoi Diagram — animated seeds, pure render pass

struct Params {
  width:     u32,   // [0]
  height:    u32,   // [1]
  numSeeds:  u32,   // [2]
  colorMode: u32,   // [3] 0=cell, 1=distance, 2=smooth
  time:      f32,   // [4]
  showEdges: u32,   // [5] 0 or 1
  edgeWidth: f32,   // [6]
  pad:       f32,   // [7]
  // 32 bytes total
};

struct Seed {
  x:    f32,  // position [0,1]
  y:    f32,
  r:    f32,  // color
  g:    f32,
  b:    f32,
  pad1: f32,
  pad2: f32,
  pad3: f32,
  // 32 bytes total
};

@group(0) @binding(0) var<uniform>            params : Params;
@group(0) @binding(1) var<storage, read>      seeds  : array<Seed>;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0)       uv  : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var corners = array<vec2<f32>, 4>(
    vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(1., 1.)
  );
  var o: VSOut;
  o.pos = vec4(corners[vid], 0., 1.);
  // UV in [0,1]: (clip + 1) * 0.5
  o.uv  = (corners[vid] + 1.0) * 0.5;
  return o;
}

// Smooth minimum for blending colors
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let aspect = f32(params.width) / f32(params.height);

  // Aspect-corrected coordinate: x stretched, y in [0,1]
  let px = uv.x * aspect;
  let py = uv.y;

  let n = params.numSeeds;

  var nearDist   = 1e10;
  var secondDist = 1e10;
  var nearIdx    = 0u;

  for (var i = 0u; i < n; i++) {
    let s  = seeds[i];
    let dx = px - s.x * aspect;
    let dy = py - s.y;
    let d  = sqrt(dx * dx + dy * dy);
    if (d < nearDist) {
      secondDist = nearDist;
      nearDist   = d;
      nearIdx    = i;
    } else if (d < secondDist) {
      secondDist = d;
    }
  }

  let ns = seeds[nearIdx];
  var color: vec3<f32>;

  if (params.colorMode == 0u) {
    // Cell: solid seed color darkened by distance
    let factor = clamp(1.0 - nearDist * 3.0, 0.1, 1.0);
    color = vec3(ns.r, ns.g, ns.b) * factor;

  } else if (params.colorMode == 1u) {
    // Distance: grayscale with hue tint
    let t = clamp(nearDist / 0.4, 0.0, 1.0);
    let seedCol = vec3(ns.r, ns.g, ns.b);
    color = seedCol * (1.0 - t) + vec3(t * 0.05);

  } else {
    // Smooth: blend seed colors using smin on distances
    // Recompute with smooth blending
    var blendColor = vec3(0.0);
    var totalW     = 0.0;

    for (var i = 0u; i < n; i++) {
      let s  = seeds[i];
      let dx = px - s.x * aspect;
      let dy = py - s.y;
      let d  = sqrt(dx * dx + dy * dy);
      // Inverse-distance weighting with smooth falloff
      let k = 20.0;
      let w = exp(-d * k);
      blendColor += vec3(s.r, s.g, s.b) * w;
      totalW     += w;
    }

    if (totalW > 0.0) {
      color = blendColor / totalW;
    } else {
      color = vec3(ns.r, ns.g, ns.b);
    }

    // Add contour lines based on distance modulo
    let contour = nearDist / 0.05;
    let frac    = fract(contour);
    let line    = 1.0 - smoothstep(0.0, 0.15, min(frac, 1.0 - frac));
    color       = mix(color, color * 0.5, line * 0.6);
  }

  // Edge detection
  if (params.showEdges == 1u) {
    let border = (secondDist - nearDist);
    if (border < params.edgeWidth * 0.02) {
      color = color * 0.3;
    }
  }

  return vec4<f32>(color, 1.0);
}
