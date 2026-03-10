struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
};

struct ParticleInstance {
  @location(0) pos: vec2<f32>,
  @location(1) vel: vec2<f32>,
};

struct RenderParams {
  aspectRatio: f32,
  particleScale: f32,
  materialType: f32,  // 0=normal, 1=fire, 2=water, 3=spark
  padding: f32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;

// Color palettes per material
fn getColor(speed: f32, material: f32) -> vec3<f32> {
  let t = clamp(speed * 1.5, 0.0, 1.0);
  let mat = u32(material);

  // Fire: dark red -> orange -> yellow -> white
  if (mat == 1u) {
    if (t < 0.33) {
      let s = t / 0.33;
      return mix(vec3<f32>(0.3, 0.05, 0.0), vec3<f32>(0.9, 0.2, 0.0), s);
    } else if (t < 0.66) {
      let s = (t - 0.33) / 0.33;
      return mix(vec3<f32>(0.9, 0.2, 0.0), vec3<f32>(1.0, 0.8, 0.1), s);
    } else {
      let s = (t - 0.66) / 0.34;
      return mix(vec3<f32>(1.0, 0.8, 0.1), vec3<f32>(1.0, 1.0, 0.9), s);
    }
  }

  // Water: deep blue -> cyan -> white
  if (mat == 2u) {
    if (t < 0.5) {
      let s = t / 0.5;
      return mix(vec3<f32>(0.0, 0.1, 0.5), vec3<f32>(0.1, 0.6, 0.9), s);
    } else {
      let s = (t - 0.5) / 0.5;
      return mix(vec3<f32>(0.1, 0.6, 0.9), vec3<f32>(0.8, 0.95, 1.0), s);
    }
  }

  // Spark: gold -> bright yellow -> white
  if (mat == 3u) {
    if (t < 0.5) {
      let s = t / 0.5;
      return mix(vec3<f32>(0.6, 0.3, 0.0), vec3<f32>(1.0, 0.85, 0.2), s);
    } else {
      let s = (t - 0.5) / 0.5;
      return mix(vec3<f32>(1.0, 0.85, 0.2), vec3<f32>(1.0, 1.0, 1.0), s);
    }
  }

  // Normal: blue -> cyan -> green -> orange -> white
  if (t < 0.25) {
    let s = t / 0.25;
    return mix(vec3<f32>(0.1, 0.2, 0.8), vec3<f32>(0.1, 0.7, 1.0), s);
  } else if (t < 0.5) {
    let s = (t - 0.25) / 0.25;
    return mix(vec3<f32>(0.1, 0.7, 1.0), vec3<f32>(0.3, 1.0, 0.5), s);
  } else if (t < 0.75) {
    let s = (t - 0.5) / 0.25;
    return mix(vec3<f32>(0.3, 1.0, 0.5), vec3<f32>(1.0, 0.7, 0.1), s);
  } else {
    let s = (t - 0.75) / 0.25;
    return mix(vec3<f32>(1.0, 0.7, 0.1), vec3<f32>(1.0, 1.0, 1.0), s);
  }
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  instance: ParticleInstance
) -> VertexOutput {
  var corners = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var output: VertexOutput;

  let speed = length(instance.vel);
  let baseSize = params.particleScale;
  let sizeBoost = clamp(speed * 0.3, 0.0, 2.0);
  let size = baseSize * (1.0 + sizeBoost);

  var offset = corners[vid] * size;
  offset.x /= params.aspectRatio;

  output.position = vec4<f32>(instance.pos + offset, 0.0, 1.0);
  output.uv = corners[vid];

  let col = getColor(speed, params.materialType);
  output.color = vec4<f32>(col, 1.0);

  return output;
}

@fragment
fn fs_main(
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
) -> @location(0) vec4<f32> {
  let dist = length(uv);
  if (dist > 1.0) {
    discard;
  }

  let alpha = 1.0 - smoothstep(0.0, 1.0, dist);
  let glow = exp(-dist * dist * 3.0);
  let finalAlpha = alpha * 0.6 + glow * 0.4;

  return vec4<f32>(color.rgb * finalAlpha, finalAlpha);
}
