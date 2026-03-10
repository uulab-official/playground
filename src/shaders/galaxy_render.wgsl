// N-Body Galaxy Simulation - Render Shader
// Instanced star rendering with multi-layer glow and blackbody coloring

struct Body {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  mass: f32,
  brightness: f32,
  temperature: f32,
  age: f32,
};

struct RenderParams {
  aspectRatio: f32,
  starScale: f32,
  time: f32,
  bodyCount: f32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> bodies: array<Body>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) starColor: vec3<f32>,
  @location(2) starBrightness: f32,
  @location(3) @interpolate(flat) bodyIndex: u32,
};

// Attempt at physically-inspired blackbody color mapping
// Maps temperature (Kelvin) to RGB
fn blackbodyColor(tempK: f32) -> vec3<f32> {
  // Attempt to approximate Planckian locus colors
  let t = clamp(tempK, 800.0, 40000.0);

  var r: f32;
  var g: f32;
  var b: f32;

  // Red channel
  if (t < 6600.0) {
    r = 1.0;
  } else {
    let x = (t / 100.0) - 55.0;
    r = clamp(1.2929 * pow(x, -0.1332), 0.0, 1.0);
  }

  // Green channel
  if (t < 6600.0) {
    let x = (t / 100.0) - 2.0;
    g = clamp(0.3901 * log(x) - 0.6318, 0.0, 1.0);
  } else {
    let x = (t / 100.0) - 50.0;
    g = clamp(1.1298 * pow(x, -0.0755), 0.0, 1.0);
  }

  // Blue channel
  if (t < 2000.0) {
    b = 0.0;
  } else if (t < 6600.0) {
    let x = (t / 100.0) - 10.0;
    b = clamp(0.5432 * log(x) - 1.1962, 0.0, 1.0);
  } else {
    b = 1.0;
  }

  return vec3<f32>(r, g, b);
}

// Pseudo-random hash for per-star variation
fn hash11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x *= x + 33.33;
  x *= x + x;
  return fract(x);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VertexOutput {
  var output: VertexOutput;

  if (iid >= u32(params.bodyCount)) {
    output.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
    return output;
  }

  let body = bodies[iid];

  // Triangle strip quad: 4 vertices -> 2 triangles
  //   0---1
  //   | / |
  //   2---3
  let quadX = f32(vid & 1u) * 2.0 - 1.0;   // -1 or 1
  let quadY = f32((vid >> 1u) & 1u) * 2.0 - 1.0; // -1 or 1

  // Star size depends on mass and brightness
  let baseSize = params.starScale * (0.008 + body.mass * 0.012);
  let sizeMultiplier = 0.7 + body.brightness * 0.6;
  let starSize = baseSize * sizeMultiplier;

  // Per-star random variation for subtle size differences
  let rnd = hash11(f32(iid) * 7.13);
  let sizeVariation = 0.8 + rnd * 0.4;

  let finalSize = starSize * sizeVariation;

  // Aspect ratio corrected offset
  var offset = vec2<f32>(
    quadX * finalSize / params.aspectRatio,
    quadY * finalSize,
  );

  let pos = vec2<f32>(body.x, body.y);
  output.position = vec4<f32>(pos + offset, 0.0, 1.0);
  output.uv = vec2<f32>(quadX, quadY);

  // Compute star color from temperature
  output.starColor = blackbodyColor(body.temperature);
  output.starBrightness = body.brightness;
  output.bodyIndex = iid;

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.uv;
  let dist = length(uv);

  // Discard pixels outside the quad circle for efficiency
  if (dist > 1.0) {
    discard;
  }

  let starCol = input.starColor;
  let brightness = input.starBrightness;
  let idx = f32(input.bodyIndex);

  // --- Multi-layer glow rendering ---

  // Layer 1: Inner core - sharp, white-hot center
  let coreRadius = 0.08;
  let coreIntensity = exp(-dist * dist / (coreRadius * coreRadius));
  let coreColor = vec3<f32>(1.0, 1.0, 1.0); // Pure white core

  // Layer 2: Middle glow - star's characteristic color
  let midRadius = 0.2;
  let midIntensity = exp(-dist * dist / (midRadius * midRadius));
  let midColor = starCol;

  // Layer 3: Outer halo - soft, wide, diffuse glow
  let outerRadius = 0.55;
  let outerIntensity = exp(-dist * dist / (outerRadius * outerRadius));
  let outerColor = starCol * 0.6 + vec3<f32>(0.1, 0.08, 0.15);

  // Layer 4: Very faint extended glow for brightest stars
  let extRadius = 0.9;
  let extIntensity = exp(-dist / extRadius) * brightness * 0.15;
  let extColor = starCol * 0.3;

  // --- Twinkle effect ---
  // Combine time with body index for unique per-star phase
  let rnd1 = hash11(idx * 3.17);
  let rnd2 = hash11(idx * 7.31);
  let twinkleFreq1 = 2.0 + rnd1 * 4.0;
  let twinkleFreq2 = 5.0 + rnd2 * 8.0;
  let twinklePhase1 = rnd1 * 6.2832;
  let twinklePhase2 = rnd2 * 6.2832;
  // Subtle oscillation: two frequencies blended
  let twinkle = 0.92 + 0.08 * (
    sin(params.time * twinkleFreq1 + twinklePhase1) *
    sin(params.time * twinkleFreq2 + twinklePhase2)
  );

  // --- Composite all layers ---
  // Core dominates at center, outer layers provide atmosphere
  var color = coreColor * coreIntensity * 1.8
            + midColor * midIntensity * 1.2
            + outerColor * outerIntensity * 0.6
            + extColor * extIntensity;

  // Apply brightness and twinkle
  color *= brightness * twinkle;

  // Subtle color boost to make stars pop against dark background
  color = pow(color, vec3<f32>(0.9));

  // Compute alpha for additive blending
  // Use combined intensity so dim outer pixels have low alpha
  let alpha = clamp(
    coreIntensity * 1.5 + midIntensity * 0.8 + outerIntensity * 0.3 + extIntensity,
    0.0,
    1.0
  ) * brightness * twinkle;

  // For additive blending (src: ONE, dst: ONE), we premultiply
  // But also support alpha blending by providing meaningful alpha
  return vec4<f32>(color, alpha);
}
