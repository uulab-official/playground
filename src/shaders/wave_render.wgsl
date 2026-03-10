// ============================================================================
// 2D Wave Equation Render Shader
// Fullscreen quad with physically-inspired water surface lighting.
// Supports four colour palettes: Ocean, Neon, Fire, Monochrome.
// ============================================================================

struct Params {
  gridW:     u32,
  gridH:     u32,
  colorMode: u32,
  frame:     u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> heights: array<f32>;

// ---------------------------------------------------------------------------
// Vertex – fullscreen triangle-strip quad
// ---------------------------------------------------------------------------

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
  output.uv = (positions[vid] + 1.0) * 0.5;
  return output;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn idx(x: u32, y: u32) -> u32 {
  return y * params.gridW + x;
}

/// Safe height sampling with clamp-to-edge.
fn sampleH(x: i32, y: i32) -> f32 {
  let cx = u32(clamp(x, 0, i32(params.gridW) - 1));
  let cy = u32(clamp(y, 0, i32(params.gridH) - 1));
  return heights[idx(cx, cy)];
}

/// Attempt at a cheap pseudo-random hash for caustic noise.
fn hash(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

/// Smooth value noise for caustics.
fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f); // smoothstep

  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/// Fractal Brownian Motion – two octaves for subtle caustics.
fn fbm(p: vec2<f32>) -> f32 {
  var val  = 0.0;
  var amp  = 0.5;
  var freq = 1.0;
  for (var i = 0; i < 3; i++) {
    val += amp * vnoise(p * freq);
    freq *= 2.0;
    amp  *= 0.5;
  }
  return val;
}

/// Attempt at a simple smooth-minimum for colour blending.
fn smoothClamp(x: f32, lo: f32, hi: f32) -> f32 {
  return clamp(x, lo, hi);
}

// ---------------------------------------------------------------------------
// Colour palettes
// ---------------------------------------------------------------------------

/// Ocean: deep indigo -> teal -> bright cyan-white on peaks.
fn paletteOcean(h: f32, spec: f32, fresnel: f32, caustic: f32) -> vec3<f32> {
  // Base colour gradient driven by height.
  let deep   = vec3<f32>(0.02, 0.04, 0.12);   // abyss
  let mid    = vec3<f32>(0.03, 0.18, 0.32);    // calm ocean
  let bright = vec3<f32>(0.15, 0.55, 0.65);    // lit teal
  let foam   = vec3<f32>(0.85, 0.95, 1.0);     // wave crests

  let t = smoothClamp(h * 0.5 + 0.5, 0.0, 1.0); // map [-1,1] -> [0,1]

  // Three-stop gradient.
  var base: vec3<f32>;
  if (t < 0.35) {
    base = mix(deep, mid, t / 0.35);
  } else if (t < 0.65) {
    base = mix(mid, bright, (t - 0.35) / 0.3);
  } else {
    base = mix(bright, foam, (t - 0.65) / 0.35);
  }

  // Add subtle caustic pattern in the troughs.
  let causticStrength = (1.0 - t) * 0.15;
  let causticColor = vec3<f32>(0.2, 0.6, 0.8) * caustic * causticStrength;

  // Fresnel rim brightening.
  let fresnelColor = vec3<f32>(0.4, 0.7, 0.9) * fresnel * 0.3;

  // Specular highlight.
  let specColor = vec3<f32>(1.0, 0.98, 0.95) * spec;

  return base + causticColor + fresnelColor + specColor;
}

/// Neon synthwave: cyan -> magenta -> purple with glow.
fn paletteNeon(h: f32, spec: f32, fresnel: f32, caustic: f32) -> vec3<f32> {
  let dark   = vec3<f32>(0.05, 0.0, 0.12);
  let purple = vec3<f32>(0.35, 0.05, 0.55);
  let cyan   = vec3<f32>(0.0, 0.85, 0.95);
  let pink   = vec3<f32>(1.0, 0.2, 0.7);

  let t = smoothClamp(h * 0.5 + 0.5, 0.0, 1.0);

  var base: vec3<f32>;
  if (t < 0.4) {
    base = mix(dark, purple, t / 0.4);
  } else if (t < 0.7) {
    base = mix(purple, cyan, (t - 0.4) / 0.3);
  } else {
    base = mix(cyan, pink, (t - 0.7) / 0.3);
  }

  // Neon glow on caustics.
  let glowColor = vec3<f32>(0.0, 1.0, 0.9) * caustic * 0.2;
  let specColor = vec3<f32>(1.0, 0.8, 1.0) * spec;
  let fresnelColor = vec3<f32>(0.6, 0.1, 0.9) * fresnel * 0.4;

  return base + glowColor + fresnelColor + specColor;
}

/// Fire / lava: dark red -> orange -> bright yellow.
fn paletteFire(h: f32, spec: f32, fresnel: f32, caustic: f32) -> vec3<f32> {
  let ember  = vec3<f32>(0.12, 0.02, 0.0);
  let red    = vec3<f32>(0.65, 0.08, 0.02);
  let orange = vec3<f32>(0.95, 0.45, 0.05);
  let yellow = vec3<f32>(1.0, 0.9, 0.4);

  let t = smoothClamp(h * 0.5 + 0.5, 0.0, 1.0);

  var base: vec3<f32>;
  if (t < 0.3) {
    base = mix(ember, red, t / 0.3);
  } else if (t < 0.6) {
    base = mix(red, orange, (t - 0.3) / 0.3);
  } else {
    base = mix(orange, yellow, (t - 0.6) / 0.4);
  }

  // Lava glow.
  let glowColor = vec3<f32>(1.0, 0.3, 0.0) * caustic * 0.15;
  let specColor = vec3<f32>(1.0, 1.0, 0.7) * spec;
  let fresnelColor = vec3<f32>(0.9, 0.2, 0.0) * fresnel * 0.3;

  return base + glowColor + fresnelColor + specColor;
}

/// Monochrome: elegant black-and-white with subtle blue tint.
fn paletteMono(h: f32, spec: f32, fresnel: f32, caustic: f32) -> vec3<f32> {
  let t = smoothClamp(h * 0.5 + 0.5, 0.0, 1.0);

  // Slight cool tint on the whites.
  let dark  = vec3<f32>(0.02, 0.02, 0.03);
  let light = vec3<f32>(0.92, 0.94, 0.96);

  var base = mix(dark, light, t);

  // Subtle caustic texture.
  base += vec3<f32>(0.1, 0.1, 0.12) * caustic * (1.0 - t) * 0.2;

  let specColor = vec3<f32>(1.0) * spec;
  let fresnelColor = vec3<f32>(0.5, 0.5, 0.55) * fresnel * 0.2;

  return base + fresnelColor + specColor;
}

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let gw = f32(params.gridW);
  let gh = f32(params.gridH);

  // Grid coordinates (flip Y so origin is bottom-left).
  let gx = uv.x * gw;
  let gy = (1.0 - uv.y) * gh;

  let ix = i32(gx);
  let iy = i32(gy);

  // ------------------------------------------------------------------
  // Height at current pixel
  // ------------------------------------------------------------------
  let h = sampleH(ix, iy);

  // ------------------------------------------------------------------
  // Surface normal via central differences
  // ------------------------------------------------------------------
  let hL = sampleH(ix - 1, iy);
  let hR = sampleH(ix + 1, iy);
  let hD = sampleH(ix, iy - 1);
  let hU = sampleH(ix, iy + 1);

  let scale = 2.0 / max(gw, gh);
  var normal = normalize(vec3<f32>(
    hL - hR,
    hD - hU,
    scale
  ));

  // ------------------------------------------------------------------
  // Lighting setup
  // ------------------------------------------------------------------

  // Light from upper-right, slightly in front of the surface.
  let lightDir = normalize(vec3<f32>(0.5, 0.6, 0.8));
  let viewDir  = vec3<f32>(0.0, 0.0, 1.0);

  // Diffuse (Lambert).
  let NdotL = max(dot(normal, lightDir), 0.0);
  let diffuse = NdotL * 0.6 + 0.15; // slight ambient floor

  // Specular (Blinn-Phong).
  let halfVec = normalize(lightDir + viewDir);
  let NdotH   = max(dot(normal, halfVec), 0.0);
  let spec    = pow(NdotH, 80.0) * 1.2;

  // Secondary soft specular for broader highlight.
  let spec2 = pow(NdotH, 16.0) * 0.25;
  let totalSpec = spec + spec2;

  // ------------------------------------------------------------------
  // Fresnel approximation (Schlick-like)
  // ------------------------------------------------------------------
  let NdotV   = max(dot(normal, viewDir), 0.0);
  let fresnel = pow(1.0 - NdotV, 3.0);

  // ------------------------------------------------------------------
  // Caustic pattern – animated noise projected onto the surface
  // ------------------------------------------------------------------
  let time = f32(params.frame) * 0.008;
  let causticUV = uv * 8.0 + vec2<f32>(time * 0.7, time * 0.5);
  let causticVal = fbm(causticUV) * 0.5 + fbm(causticUV * 1.5 + vec2<f32>(3.7, 1.2)) * 0.5;

  // Modulate caustics by the Laplacian (light focusing in troughs).
  let lap = abs(hL + hR + hU + hD - 4.0 * h);
  let caustic = causticVal * clamp(lap * 2.0, 0.0, 1.0);

  // ------------------------------------------------------------------
  // Sky gradient for environment reflection
  // ------------------------------------------------------------------
  let reflectDir = reflect(-viewDir, normal);
  let skyT = clamp(reflectDir.y * 0.5 + 0.5, 0.0, 1.0);
  let skyColor = mix(
    vec3<f32>(0.15, 0.25, 0.4),  // horizon
    vec3<f32>(0.4, 0.65, 0.95),  // zenith
    skyT
  );
  let envReflection = skyColor * fresnel * 0.2;

  // ------------------------------------------------------------------
  // Compose final colour via selected palette
  // ------------------------------------------------------------------
  var color: vec3<f32>;
  let mode = params.colorMode;

  if (mode == 0u) {
    color = paletteOcean(h, totalSpec, fresnel, caustic);
  } else if (mode == 1u) {
    color = paletteNeon(h, totalSpec, fresnel, caustic);
  } else if (mode == 2u) {
    color = paletteFire(h, totalSpec, fresnel, caustic);
  } else {
    color = paletteMono(h, totalSpec, fresnel, caustic);
  }

  // Apply diffuse shading.
  color *= diffuse;

  // Add environment reflection (only for ocean and mono; neon/fire have their own glow).
  if (mode == 0u || mode == 3u) {
    color += envReflection;
  }

  // ------------------------------------------------------------------
  // Subtle vignette for depth
  // ------------------------------------------------------------------
  let center = uv - 0.5;
  let vignette = 1.0 - dot(center, center) * 0.6;
  color *= vignette;

  // Tone-map to avoid clipping.
  color = color / (color + vec3<f32>(1.0));

  // Slight gamma correction for perceptual brightness.
  color = pow(color, vec3<f32>(0.9));

  return vec4<f32>(color, 1.0);
}
