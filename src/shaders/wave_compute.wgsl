// ============================================================================
// 2D Wave Equation Compute Shader
// Finite-difference time-domain (FDTD) simulation on a uniform grid.
// Uses three ping-pong buffers: previous, current, and output height fields.
// ============================================================================

struct Params {
  gridW:       u32,
  gridH:       u32,
  mouseX:      f32,
  mouseY:      f32,
  mouseActive: u32,
  frame:       u32,
  damping:     f32,
  speed:       f32,
  mouseRadius: f32,
  dt:          f32,
  isPaused:    u32,
  padding:     u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read>       prev: array<f32>;
@group(0) @binding(2) var<storage, read>       curr: array<f32>;
@group(0) @binding(3) var<storage, read_write> next: array<f32>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn idx(x: u32, y: u32) -> u32 {
  return y * params.gridW + x;
}

/// Clamp-to-edge (Neumann reflective) boundary sampling.
fn sample(x: i32, y: i32) -> f32 {
  let cx = clamp(x, 0, i32(params.gridW) - 1);
  let cy = clamp(y, 0, i32(params.gridH) - 1);
  return curr[idx(u32(cx), u32(cy))];
}

/// Gaussian bell curve for smooth wave injection.
fn gaussian(dist: f32, radius: f32) -> f32 {
  let sigma = radius * 0.4;
  return exp(-(dist * dist) / (2.0 * sigma * sigma));
}

// ---------------------------------------------------------------------------
// Main compute kernel – one thread per grid cell
// ---------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;

  // Out-of-bounds guard for non-power-of-two grids.
  if (x >= params.gridW || y >= params.gridH) {
    return;
  }

  let i = idx(x, y);

  // Paused – just copy through.
  if (params.isPaused > 0u) {
    next[i] = curr[i];
    return;
  }

  let ix = i32(x);
  let iy = i32(y);

  // ------------------------------------------------------------------
  // 5-point Laplacian stencil
  // ------------------------------------------------------------------
  let lap = sample(ix + 1, iy)
          + sample(ix - 1, iy)
          + sample(ix, iy + 1)
          + sample(ix, iy - 1)
          - 4.0 * curr[i];

  // Wave equation: next = 2*curr - prev + c^2 * dt^2 * laplacian
  let c     = params.speed;
  let dt    = params.dt;
  let c2dt2 = c * c * dt * dt;

  var h = 2.0 * curr[i] - prev[i] + c2dt2 * lap;

  // Apply damping to prevent infinite oscillation.
  h *= params.damping;

  // ------------------------------------------------------------------
  // Mouse interaction – Gaussian splash
  // ------------------------------------------------------------------
  if (params.mouseActive > 0u) {
    let mx = params.mouseX * f32(params.gridW);
    let my = params.mouseY * f32(params.gridH);
    let dx = f32(x) - mx;
    let dy = f32(y) - my;
    let dist = sqrt(dx * dx + dy * dy);
    let radius = params.mouseRadius;

    if (dist < radius * 2.5) {
      // Inject energy as a smooth Gaussian bump.
      let strength = 2.0 * gaussian(dist, radius);
      // Oscillate injection direction over time for visual interest.
      let phase = sin(f32(params.frame) * 0.15);
      h += strength * phase;
    }
  }

  // ------------------------------------------------------------------
  // Autonomous wave sources – two rotating emitters
  // ------------------------------------------------------------------
  let t = f32(params.frame) * 0.02;

  // Source 1 – orbits center.
  let s1x = f32(params.gridW) * (0.5 + 0.2 * cos(t * 1.3));
  let s1y = f32(params.gridH) * (0.5 + 0.2 * sin(t * 1.3));
  let d1  = sqrt(pow(f32(x) - s1x, 2.0) + pow(f32(y) - s1y, 2.0));
  if (d1 < 4.0 && params.frame % 60u < 3u) {
    h += 1.5 * gaussian(d1, 3.0);
  }

  // Source 2 – opposite phase, different orbit.
  let s2x = f32(params.gridW) * (0.5 - 0.25 * sin(t * 0.9));
  let s2y = f32(params.gridH) * (0.5 + 0.25 * cos(t * 0.7));
  let d2  = sqrt(pow(f32(x) - s2x, 2.0) + pow(f32(y) - s2y, 2.0));
  if (d2 < 4.0 && (params.frame + 30u) % 60u < 3u) {
    h -= 1.5 * gaussian(d2, 3.0);
  }

  // ------------------------------------------------------------------
  // Neumann reflective boundaries – mirror interior values to edges
  // ------------------------------------------------------------------
  if (x == 0u) {
    h = curr[idx(1u, y)];
  } else if (x == params.gridW - 1u) {
    h = curr[idx(params.gridW - 2u, y)];
  }
  if (y == 0u) {
    h = curr[idx(x, 1u)];
  } else if (y == params.gridH - 1u) {
    h = curr[idx(x, params.gridH - 2u)];
  }

  // Clamp to prevent numerical blowup.
  h = clamp(h, -5.0, 5.0);

  next[i] = h;
}
