// Navier-Stokes Fluid Simulation - Render Shader
// Fullscreen quad with multiple visualization modes

struct RenderParams {
  gridW: u32,
  gridH: u32,
  displayMode: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;
@group(0) @binding(1) var<storage, read> dye: array<f32>;
@group(0) @binding(2) var<storage, read> velocity: array<f32>;
@group(0) @binding(3) var<storage, read> pressure: array<f32>;

// ---------------------------------------------------------------------------
// Vertex shader: fullscreen quad via triangle strip (4 verts)
// ---------------------------------------------------------------------------

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
    vec2<f32>( 1.0,  1.0)
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vid], 0.0, 1.0);
  out.uv = (pos[vid] + 1.0) * 0.5;
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn idx(x: u32, y: u32) -> u32 {
  return y * params.gridW + x;
}

fn sampleDye(x: u32, y: u32) -> vec4<f32> {
  let base = idx(x, y) * 4u;
  return vec4<f32>(dye[base], dye[base + 1u], dye[base + 2u], dye[base + 3u]);
}

fn sampleVelocity(x: u32, y: u32) -> vec2<f32> {
  let base = idx(x, y) * 2u;
  return vec2<f32>(velocity[base], velocity[base + 1u]);
}

fn samplePressure(x: u32, y: u32) -> f32 {
  return pressure[idx(x, y)];
}

// Bilinear sample dye at fractional grid coordinates
fn bilinearDye(gx: f32, gy: f32) -> vec4<f32> {
  let w = f32(params.gridW);
  let h = f32(params.gridH);
  let cx = clamp(gx, 0.0, w - 1.001);
  let cy = clamp(gy, 0.0, h - 1.001);

  let x0 = u32(floor(cx));
  let y0 = u32(floor(cy));
  let x1 = min(x0 + 1u, params.gridW - 1u);
  let y1 = min(y0 + 1u, params.gridH - 1u);

  let sx = cx - floor(cx);
  let sy = cy - floor(cy);

  let d00 = sampleDye(x0, y0);
  let d10 = sampleDye(x1, y0);
  let d01 = sampleDye(x0, y1);
  let d11 = sampleDye(x1, y1);

  return mix(mix(d00, d10, sx), mix(d01, d11, sx), sy);
}

// Bilinear sample velocity at fractional grid coordinates
fn bilinearVelocity(gx: f32, gy: f32) -> vec2<f32> {
  let w = f32(params.gridW);
  let h = f32(params.gridH);
  let cx = clamp(gx, 0.0, w - 1.001);
  let cy = clamp(gy, 0.0, h - 1.001);

  let x0 = u32(floor(cx));
  let y0 = u32(floor(cy));
  let x1 = min(x0 + 1u, params.gridW - 1u);
  let y1 = min(y0 + 1u, params.gridH - 1u);

  let sx = cx - floor(cx);
  let sy = cy - floor(cy);

  let v00 = sampleVelocity(x0, y0);
  let v10 = sampleVelocity(x1, y0);
  let v01 = sampleVelocity(x0, y1);
  let v11 = sampleVelocity(x1, y1);

  return mix(mix(v00, v10, sx), mix(v01, v11, sx), sy);
}

// Compute vorticity (curl of 2D velocity = scalar)
fn computeCurl(gx: f32, gy: f32) -> f32 {
  let eps = 1.0;
  let vT = bilinearVelocity(gx, gy + eps);
  let vB = bilinearVelocity(gx, gy - eps);
  let vR = bilinearVelocity(gx + eps, gy);
  let vL = bilinearVelocity(gx - eps, gy);

  // curl = dvx/dy - dvy/dx
  return (vR.y - vL.y) - (vT.x - vB.x);
}

// HSV to RGB conversion
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c = v * s;
  let hp = h * 6.0;
  let x = c * (1.0 - abs(hp % 2.0 - 1.0));
  let m = v - c;

  var rgb: vec3<f32>;
  if (hp < 1.0) { rgb = vec3<f32>(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3<f32>(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3<f32>(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3<f32>(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3<f32>(x, 0.0, c); }
  else { rgb = vec3<f32>(c, 0.0, x); }

  return rgb + vec3<f32>(m);
}

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Map screen UV to grid coordinates (flip Y for standard orientation)
  let gx = uv.x * f32(params.gridW);
  let gy = (1.0 - uv.y) * f32(params.gridH);

  var color = vec3<f32>(0.0);

  // -----------------------------------------------------------------------
  // Mode 0: Dye visualization (default, beautiful fluid colors)
  // -----------------------------------------------------------------------
  if (params.displayMode == 0u) {
    // Main dye sample with bilinear filtering
    let d = bilinearDye(gx, gy);

    // Soft bloom: sample neighbors and blend
    let bloomRadius = 1.5;
    let b1 = bilinearDye(gx + bloomRadius, gy).rgb;
    let b2 = bilinearDye(gx - bloomRadius, gy).rgb;
    let b3 = bilinearDye(gx, gy + bloomRadius).rgb;
    let b4 = bilinearDye(gx, gy - bloomRadius).rgb;
    let b5 = bilinearDye(gx + bloomRadius * 0.707, gy + bloomRadius * 0.707).rgb;
    let b6 = bilinearDye(gx - bloomRadius * 0.707, gy - bloomRadius * 0.707).rgb;
    let b7 = bilinearDye(gx + bloomRadius * 0.707, gy - bloomRadius * 0.707).rgb;
    let b8 = bilinearDye(gx - bloomRadius * 0.707, gy + bloomRadius * 0.707).rgb;

    let bloomAvg = (b1 + b2 + b3 + b4 + b5 + b6 + b7 + b8) * 0.125;
    let bloomContrib = max(bloomAvg - vec3<f32>(0.3), vec3<f32>(0.0)) * 0.15;

    color = d.rgb + bloomContrib;

    // Tone mapping (soft) to prevent harsh clipping
    color = color / (color + vec3<f32>(1.0));

    // Subtle vignette
    let center = uv - vec2<f32>(0.5);
    let vignette = 1.0 - dot(center, center) * 0.8;
    color *= vignette;

    // Gamma correction
    color = pow(color, vec3<f32>(1.0 / 2.2));
  }

  // -----------------------------------------------------------------------
  // Mode 1: Velocity magnitude visualization
  // -----------------------------------------------------------------------
  else if (params.displayMode == 1u) {
    let vel = bilinearVelocity(gx, gy);
    let speed = length(vel);

    // Map speed to color: dark blue -> cyan -> green -> yellow -> red
    let t = clamp(speed * 0.02, 0.0, 1.0);
    let angle = atan2(vel.y, vel.x);
    let hue = (angle / (2.0 * 3.14159265) + 0.5);

    // Use HSV: hue from direction, saturation/value from speed
    color = hsv2rgb(hue, 0.7 + t * 0.3, t * 0.9 + 0.1);

    // Subtle speed overlay
    let speedColor = vec3<f32>(
      smoothstep(0.3, 0.8, t),
      smoothstep(0.0, 0.5, t) * (1.0 - smoothstep(0.5, 1.0, t)),
      1.0 - smoothstep(0.0, 0.4, t)
    );
    color = mix(color, speedColor, 0.3);
  }

  // -----------------------------------------------------------------------
  // Mode 2: Pressure field visualization
  // -----------------------------------------------------------------------
  else if (params.displayMode == 2u) {
    let gxi = clamp(u32(gx), 0u, params.gridW - 1u);
    let gyi = clamp(u32(gy), 0u, params.gridH - 1u);
    let p = samplePressure(gxi, gyi);

    // Blue for negative, white for zero, red for positive
    let scale = 0.05;
    let pNorm = clamp(p * scale, -1.0, 1.0);

    if (pNorm > 0.0) {
      // Positive: white to red
      color = mix(vec3<f32>(0.15, 0.15, 0.2), vec3<f32>(1.0, 0.2, 0.1), pNorm);
    } else {
      // Negative: white to blue
      color = mix(vec3<f32>(0.15, 0.15, 0.2), vec3<f32>(0.1, 0.3, 1.0), -pNorm);
    }

    // Add subtle grid pattern for reference
    let gridLine = step(0.97, fract(gx)) + step(0.97, fract(gy));
    color = mix(color, color * 0.7, gridLine * 0.15);
  }

  // -----------------------------------------------------------------------
  // Mode 3: Vorticity / curl visualization (artistic)
  // -----------------------------------------------------------------------
  else {
    let curl = computeCurl(gx, gy);

    // Map vorticity to vivid colors
    let curlAbs = min(abs(curl) * 0.1, 1.0);
    let sign = step(0.0, curl) * 2.0 - 1.0;

    // Clockwise: magenta/purple, Counter-clockwise: teal/cyan
    let posCurl = vec3<f32>(0.8, 0.1, 0.9);  // magenta
    let negCurl = vec3<f32>(0.0, 0.8, 0.8);   // cyan
    let baseColor = mix(negCurl, posCurl, sign * 0.5 + 0.5);

    // Intensity from absolute vorticity
    color = baseColor * curlAbs;

    // Add dye as subtle overlay for context
    let d = bilinearDye(gx, gy);
    color += d.rgb * 0.15;

    // Tone mapping
    color = color / (color + vec3<f32>(0.8));
    color = pow(color, vec3<f32>(1.0 / 2.2));
  }

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
