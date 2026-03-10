// Navier-Stokes Fluid Simulation - Compute Shaders
// Stable Fluids method (Jos Stam) with multiple compute passes
// 2D Eulerian grid-based simulation

struct Params {
  gridW: u32,
  gridH: u32,
  dt: f32,
  viscosity: f32,
  mouseX: f32,
  mouseY: f32,
  mouseDX: f32,
  mouseDY: f32,
  mouseActive: u32,
  dyeR: f32,
  dyeG: f32,
  dyeB: f32,
  splatRadius: f32,
  frame: u32,
  velocityDissipation: f32,
  densityDissipation: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> velocityIn: array<f32>;
@group(0) @binding(2) var<storage, read_write> velocityOut: array<f32>;
@group(0) @binding(3) var<storage, read> pressure: array<f32>;
@group(0) @binding(4) var<storage, read_write> pressureTemp: array<f32>;
@group(0) @binding(5) var<storage, read_write> divergence: array<f32>;
@group(0) @binding(6) var<storage, read> dyeIn: array<f32>;
@group(0) @binding(7) var<storage, read_write> dyeOut: array<f32>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn idx(x: u32, y: u32) -> u32 {
  return y * params.gridW + x;
}

fn clampX(x: i32) -> u32 {
  return u32(clamp(x, 0, i32(params.gridW) - 1));
}

fn clampY(y: i32) -> u32 {
  return u32(clamp(y, 0, i32(params.gridH) - 1));
}

fn readVelocity(x: u32, y: u32) -> vec2<f32> {
  let base = idx(x, y) * 2u;
  return vec2<f32>(velocityIn[base], velocityIn[base + 1u]);
}

fn writeVelocity(x: u32, y: u32, v: vec2<f32>) {
  let base = idx(x, y) * 2u;
  velocityOut[base] = v.x;
  velocityOut[base + 1u] = v.y;
}

fn readDye(x: u32, y: u32) -> vec4<f32> {
  let base = idx(x, y) * 4u;
  return vec4<f32>(dyeIn[base], dyeIn[base + 1u], dyeIn[base + 2u], dyeIn[base + 3u]);
}

fn writeDye(x: u32, y: u32, c: vec4<f32>) {
  let base = idx(x, y) * 4u;
  dyeOut[base] = c.x;
  dyeOut[base + 1u] = c.y;
  dyeOut[base + 2u] = c.z;
  dyeOut[base + 3u] = c.w;
}

// Bilinear interpolation for velocity field
fn bilinearVelocity(fx: f32, fy: f32) -> vec2<f32> {
  let w = f32(params.gridW);
  let h = f32(params.gridH);

  // Clamp to valid range with half-cell margin
  let cx = clamp(fx, 0.5, w - 1.5);
  let cy = clamp(fy, 0.5, h - 1.5);

  let x0 = u32(floor(cx));
  let y0 = u32(floor(cy));
  let x1 = min(x0 + 1u, params.gridW - 1u);
  let y1 = min(y0 + 1u, params.gridH - 1u);

  let sx = cx - floor(cx);
  let sy = cy - floor(cy);

  let v00 = readVelocity(x0, y0);
  let v10 = readVelocity(x1, y0);
  let v01 = readVelocity(x0, y1);
  let v11 = readVelocity(x1, y1);

  let top = mix(v00, v10, sx);
  let bot = mix(v01, v11, sx);
  return mix(top, bot, sy);
}

// Bilinear interpolation for dye field
fn bilinearDye(fx: f32, fy: f32) -> vec4<f32> {
  let w = f32(params.gridW);
  let h = f32(params.gridH);

  let cx = clamp(fx, 0.5, w - 1.5);
  let cy = clamp(fy, 0.5, h - 1.5);

  let x0 = u32(floor(cx));
  let y0 = u32(floor(cy));
  let x1 = min(x0 + 1u, params.gridW - 1u);
  let y1 = min(y0 + 1u, params.gridH - 1u);

  let sx = cx - floor(cx);
  let sy = cy - floor(cy);

  let d00 = readDye(x0, y0);
  let d10 = readDye(x1, y0);
  let d01 = readDye(x0, y1);
  let d11 = readDye(x1, y1);

  let top = mix(d00, d10, sx);
  let bot = mix(d01, d11, sx);
  return mix(top, bot, sy);
}

// ---------------------------------------------------------------------------
// Pass 1: Add external forces (mouse interaction)
// ---------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn addForces(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.gridW || y >= params.gridH) { return; }

  var vel = readVelocity(x, y);
  var dye = readDye(x, y);

  if (params.mouseActive > 0u) {
    let mx = params.mouseX * f32(params.gridW);
    let my = params.mouseY * f32(params.gridH);
    let dx = f32(x) - mx;
    let dy = f32(y) - my;
    let distSq = dx * dx + dy * dy;
    let radius = params.splatRadius;
    let radiusSq = radius * radius;

    // Gaussian splat falloff
    let strength = exp(-distSq / (2.0 * radiusSq));

    // Add velocity from mouse movement
    let forceScale = 500.0;
    vel += vec2<f32>(params.mouseDX, params.mouseDY) * strength * forceScale;

    // Add colored dye
    let dyeStrength = strength * 1.2;
    dye += vec4<f32>(
      params.dyeR * dyeStrength,
      params.dyeG * dyeStrength,
      params.dyeB * dyeStrength,
      dyeStrength
    );
    dye = clamp(dye, vec4<f32>(0.0), vec4<f32>(5.0));
  }

  writeVelocity(x, y, vel);
  writeDye(x, y, dye);
}

// ---------------------------------------------------------------------------
// Pass 2: Advect velocity (Semi-Lagrangian)
// ---------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn advectVelocity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.gridW || y >= params.gridH) { return; }

  let vel = readVelocity(x, y);

  // Trace particle backwards in time
  let prevX = f32(x) - params.dt * vel.x;
  let prevY = f32(y) - params.dt * vel.y;

  // Interpolate velocity at previous position
  var newVel = bilinearVelocity(prevX, prevY);

  // Apply dissipation to prevent energy buildup
  newVel *= params.velocityDissipation;

  // Enforce boundary conditions: zero normal velocity at walls
  if (x == 0u) { newVel.x = max(newVel.x, 0.0); }
  if (x == params.gridW - 1u) { newVel.x = min(newVel.x, 0.0); }
  if (y == 0u) { newVel.y = max(newVel.y, 0.0); }
  if (y == params.gridH - 1u) { newVel.y = min(newVel.y, 0.0); }

  writeVelocity(x, y, newVel);
}

// ---------------------------------------------------------------------------
// Pass 3: Advect dye (Semi-Lagrangian)
// ---------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn advectDye(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.gridW || y >= params.gridH) { return; }

  let vel = readVelocity(x, y);

  // Trace particle backwards in time
  let prevX = f32(x) - params.dt * vel.x;
  let prevY = f32(y) - params.dt * vel.y;

  // Interpolate dye at previous position
  var newDye = bilinearDye(prevX, prevY);

  // Apply density dissipation for gradual fadeout
  newDye *= params.densityDissipation;

  writeDye(x, y, newDye);
}

// ---------------------------------------------------------------------------
// Pass 4: Compute divergence of velocity field
// ---------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn computeDivergence(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.gridW || y >= params.gridH) { return; }

  // Sample neighbors with boundary clamping
  let xL = clampX(i32(x) - 1);
  let xR = clampX(i32(x) + 1);
  let yB = clampY(i32(y) - 1);
  let yT = clampY(i32(y) + 1);

  let vL = readVelocity(xL, y);
  let vR = readVelocity(xR, y);
  let vB = readVelocity(x, yB);
  let vT = readVelocity(x, yT);

  // Central differences
  let div = 0.5 * (vR.x - vL.x + vT.y - vB.y);

  divergence[idx(x, y)] = div;

  // Clear pressure for Jacobi iteration start
  pressureTemp[idx(x, y)] = 0.0;
}

// ---------------------------------------------------------------------------
// Pass 5: Pressure solve (Jacobi iteration)
// Needs to run 20-40 times per frame, ping-ponging pressure/pressureTemp
// ---------------------------------------------------------------------------

@compute @workgroup_size(16, 16)
fn pressureSolve(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.gridW || y >= params.gridH) { return; }

  let xL = clampX(i32(x) - 1);
  let xR = clampX(i32(x) + 1);
  let yB = clampY(i32(y) - 1);
  let yT = clampY(i32(y) + 1);

  // Read pressure from input buffer (ping-pong)
  let pL = pressure[idx(xL, y)];
  let pR = pressure[idx(xR, y)];
  let pB = pressure[idx(x, yB)];
  let pT = pressure[idx(x, yT)];

  let div = divergence[idx(x, y)];

  // Jacobi iteration: solve Laplacian(p) = divergence
  let newP = (pL + pR + pB + pT - div) * 0.25;

  pressureTemp[idx(x, y)] = newP;
}

// ---------------------------------------------------------------------------
// Pass 6: Subtract pressure gradient (projection step)
// Makes velocity field divergence-free
// ---------------------------------------------------------------------------

// Compute vorticity (curl) at grid cell from velocityIn
fn cellCurl(cx: u32, cy: u32) -> f32 {
  let xL = clampX(i32(cx) - 1);
  let xR = clampX(i32(cx) + 1);
  let yB = clampY(i32(cy) - 1);
  let yT = clampY(i32(cy) + 1);
  let vL = readVelocity(xL, cy);
  let vR = readVelocity(xR, cy);
  let vB = readVelocity(cx, yB);
  let vT = readVelocity(cx, yT);
  return (vR.y - vL.y) - (vT.x - vB.x);
}

@compute @workgroup_size(16, 16)
fn subtractGradient(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.gridW || y >= params.gridH) { return; }

  let xL = clampX(i32(x) - 1);
  let xR = clampX(i32(x) + 1);
  let yB = clampY(i32(y) - 1);
  let yT = clampY(i32(y) + 1);

  let pL = pressure[idx(xL, y)];
  let pR = pressure[idx(xR, y)];
  let pB = pressure[idx(x, yB)];
  let pT = pressure[idx(x, yT)];

  var vel = readVelocity(x, y);

  // Subtract pressure gradient (projection step)
  vel.x -= 0.5 * (pR - pL);
  vel.y -= 0.5 * (pT - pB);

  // Vorticity confinement: amplifies existing vortices to prevent dissipation
  let wC = cellCurl(x, y);
  let wL = cellCurl(clampX(i32(x) - 1), y);
  let wR = cellCurl(clampX(i32(x) + 1), y);
  let wB = cellCurl(x, clampY(i32(y) - 1));
  let wT = cellCurl(x, clampY(i32(y) + 1));

  var N = vec2<f32>(abs(wR) - abs(wL), abs(wT) - abs(wB)) * 0.5;
  let nLen = length(N);
  if (nLen > 0.0001) { N /= nLen; }
  vel += vec2<f32>(N.y * wC, -N.x * wC) * 0.4 * params.dt;

  // Enforce boundary: zero normal velocity at walls
  if (x == 0u) { vel.x = max(vel.x, 0.0); }
  if (x == params.gridW - 1u) { vel.x = min(vel.x, 0.0); }
  if (y == 0u) { vel.y = max(vel.y, 0.0); }
  if (y == params.gridH - 1u) { vel.y = min(vel.y, 0.0); }

  writeVelocity(x, y, vel);
}
