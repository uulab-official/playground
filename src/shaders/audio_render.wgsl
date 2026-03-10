// Audio Visualizer - Render Shader
// Instanced soft-particle rendering with frequency-based coloring and glow.

struct Particle {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  life: f32,
  freq: f32,
  size: f32,
  brightness: f32,
};

struct RenderParams {
  aspectRatio: f32,
  time: f32,
  bassLevel: f32,
  midLevel: f32,
  trebleLevel: f32,
  mode: u32,
  glowIntensity: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,          // quad UV for circular distance
  @location(1) freq: f32,              // frequency band for coloring
  @location(2) brightness: f32,        // particle brightness
  @location(3) life: f32,              // particle life for fade
  @location(4) size: f32,              // particle size for glow tuning
  @location(5) speed: f32,             // velocity magnitude for motion streaks
};

// --- Vertex Shader ---

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VertexOutput {
  let p = particles[iid];

  // Skip dead particles by placing them offscreen
  if (p.life <= 0.0) {
    var out: VertexOutput;
    out.position = vec4<f32>(-10.0, -10.0, 0.0, 1.0);
    out.uv = vec2<f32>(0.0);
    out.freq = 0.0;
    out.brightness = 0.0;
    out.life = 0.0;
    out.size = 0.0;
    out.speed = 0.0;
    return out;
  }

  // Triangle strip quad: 4 vertices forming 2 triangles
  //   0---2
  //   | / |
  //   1---3
  let quadUV = array<vec2<f32>, 4>(
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
  );

  let uv = quadUV[vid];

  // Scale size: base particle size + glow halo multiplier
  let glowScale = 2.5; // extra space for glow falloff
  let size = p.size * glowScale;

  // Velocity-based elongation for motion streaks
  let speed = length(vec2<f32>(p.vx, p.vy));
  let stretch = 1.0 + speed * 0.3;
  var dir = vec2<f32>(1.0, 0.0);
  if (speed > 0.001) {
    dir = normalize(vec2<f32>(p.vx, p.vy));
  }
  let perp = vec2<f32>(-dir.y, dir.x);

  // Elongate along velocity direction
  let offset = (dir * uv.x * stretch + perp * uv.y) * size;

  // Apply aspect ratio correction
  let correctedOffset = vec2<f32>(offset.x / params.aspectRatio, offset.y);

  var out: VertexOutput;
  out.position = vec4<f32>(p.x + correctedOffset.x, p.y + correctedOffset.y, 0.0, 1.0);
  out.uv = uv;
  out.freq = p.freq;
  out.brightness = p.brightness;
  out.life = p.life;
  out.size = p.size;
  out.speed = speed;

  return out;
}

// --- Color utilities ---

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let hh = fract(h) * 6.0;
  let i = u32(hh);
  let f = fract(hh);
  let p = v * (1.0 - s);
  let q = v * (1.0 - s * f);
  let t = v * (1.0 - s * (1.0 - f));

  switch i {
    case 0u: { return vec3<f32>(v, t, p); }
    case 1u: { return vec3<f32>(q, v, p); }
    case 2u: { return vec3<f32>(p, v, t); }
    case 3u: { return vec3<f32>(p, q, v); }
    case 4u: { return vec3<f32>(t, p, v); }
    default: { return vec3<f32>(v, p, q); }
  }
}

// Attempt to get a rich, musical color palette from frequency
fn frequencyColor(freq: f32, t: f32) -> vec3<f32> {
  // freq: 0 = lowest bass, 1 = highest treble

  // Base hue mapping:
  //   Bass (0.0-0.2)    -> warm red/orange      hue ~0.0-0.08
  //   Low-mid (0.2-0.4) -> orange/yellow        hue ~0.08-0.15
  //   Mid (0.4-0.6)     -> green/cyan           hue ~0.25-0.5
  //   High-mid (0.6-0.8)-> cyan/blue            hue ~0.5-0.65
  //   Treble (0.8-1.0)  -> blue/violet/magenta  hue ~0.65-0.85

  // Piecewise mapping for richer color distribution
  var hue: f32;
  if (freq < 0.2) {
    hue = mix(0.0, 0.08, freq / 0.2);
  } else if (freq < 0.4) {
    hue = mix(0.08, 0.18, (freq - 0.2) / 0.2);
  } else if (freq < 0.6) {
    hue = mix(0.25, 0.48, (freq - 0.4) / 0.2);
  } else if (freq < 0.8) {
    hue = mix(0.5, 0.65, (freq - 0.6) / 0.2);
  } else {
    hue = mix(0.68, 0.85, (freq - 0.8) / 0.2);
  }

  // Slowly cycle hue over time for visual interest
  hue = fract(hue + t * 0.02);

  // High saturation, slight variation with frequency
  let sat = 0.8 + freq * 0.15;
  let val = 1.0;

  return hsv2rgb(hue, sat, val);
}

// --- Fragment Shader ---

@fragment
fn fs_main(
  @location(0) uv: vec2<f32>,
  @location(1) freq: f32,
  @location(2) brightness: f32,
  @location(3) life: f32,
  @location(4) size: f32,
  @location(5) speed: f32,
) -> @location(0) vec4<f32> {

  // Distance from center of the quad
  let dist = length(uv);

  // Discard fragments outside the circular region (with margin for glow)
  if (dist > 1.0) {
    discard;
  }

  // --- Core particle shape ---
  // Inner solid core with smooth edge
  let coreRadius = 0.3;
  let core = 1.0 - smoothstep(0.0, coreRadius, dist);

  // --- Glow layers ---
  // Exponential falloff for bloom-like glow
  let glow1 = exp(-dist * 3.0) * 0.7;         // tight inner glow
  let glow2 = exp(-dist * 1.5) * 0.3;         // wider soft glow
  let glow3 = exp(-dist * dist * 8.0) * 0.15; // gaussian bloom halo

  let glowIntensity = params.glowIntensity;
  let totalGlow = core + (glow1 + glow2 + glow3) * glowIntensity;

  // --- Color ---
  let baseColor = frequencyColor(freq, params.time);

  // Add white-hot center for bright particles
  let hotCenter = vec3<f32>(1.0) * core * core * brightness * 0.5;

  // Final color: base tinted by glow + hot center
  let color = baseColor * totalGlow * brightness + hotCenter;

  // --- Alpha ---
  // Combine glow shape with life fade
  let lifeFade = smoothstep(0.0, 0.5, life);
  let alpha = clamp(totalGlow * brightness * lifeFade, 0.0, 1.0);

  // Premultiplied alpha for additive-like blending
  return vec4<f32>(color * alpha, alpha);
}
