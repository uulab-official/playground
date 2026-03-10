// Falling Sand cellular automata compute shader
// Materials: 0=empty, 1=sand, 2=water, 3=fire, 4=stone, 5=steam

struct Params {
  width: u32,
  height: u32,
  frame: u32,
  isPaused: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> gridIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> gridOut: array<u32>;

fn getCell(x: i32, y: i32) -> u32 {
  if (x < 0 || x >= i32(params.width) || y < 0 || y >= i32(params.height)) {
    return 4u; // treat out-of-bounds as stone
  }
  return gridIn[u32(y) * params.width + u32(x)];
}

fn isEmpty(x: i32, y: i32) -> bool {
  return getCell(x, y) == 0u;
}

fn hash(n: u32) -> u32 {
  var x = n;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = ((x >> 16u) ^ x) * 0x45d9f3bu;
  x = (x >> 16u) ^ x;
  return x;
}

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= params.width || y >= params.height) { return; }

  let idx = y * params.width + x;
  let ix = i32(x);
  let iy = i32(y);

  if (params.isPaused > 0u) {
    gridOut[idx] = gridIn[idx];
    return;
  }

  let cell = gridIn[idx];
  let rng = hash(idx + params.frame * 31u);
  let rand01 = f32(rng % 1000u) / 1000.0;
  let goLeft = (rng % 2u) == 0u;

  // Default: keep current
  gridOut[idx] = cell;

  // Empty: check if something falls into us
  if (cell == 0u) {
    // Sand from above?
    let above = getCell(ix, iy - 1);
    if (above == 1u) {
      gridOut[idx] = 1u;
      return;
    }
    // Water from above?
    if (above == 2u) {
      gridOut[idx] = 2u;
      return;
    }
    // Steam from below?
    let below = getCell(ix, iy + 1);
    if (below == 5u) {
      gridOut[idx] = 5u;
      return;
    }
    return;
  }

  // Sand: falls down, then diagonally
  if (cell == 1u) {
    if (isEmpty(ix, iy + 1)) {
      gridOut[idx] = 0u; // we move down
      return;
    }
    // Diagonal fall
    if (goLeft) {
      if (isEmpty(ix - 1, iy + 1)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix + 1, iy + 1)) { gridOut[idx] = 0u; return; }
    } else {
      if (isEmpty(ix + 1, iy + 1)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix - 1, iy + 1)) { gridOut[idx] = 0u; return; }
    }
    // Sand displaces water
    let below = getCell(ix, iy + 1);
    if (below == 2u) {
      gridOut[idx] = 2u; // swap: sand goes down, water comes up
      return;
    }
    return;
  }

  // Water: flows down and sideways
  if (cell == 2u) {
    if (isEmpty(ix, iy + 1)) {
      gridOut[idx] = 0u;
      return;
    }
    if (goLeft) {
      if (isEmpty(ix - 1, iy + 1)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix + 1, iy + 1)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix - 1, iy)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix + 1, iy)) { gridOut[idx] = 0u; return; }
    } else {
      if (isEmpty(ix + 1, iy + 1)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix - 1, iy + 1)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix + 1, iy)) { gridOut[idx] = 0u; return; }
      if (isEmpty(ix - 1, iy)) { gridOut[idx] = 0u; return; }
    }
    return;
  }

  // Fire: rises, flickers, dies
  if (cell == 3u) {
    // Fire turns water to steam
    if (getCell(ix, iy - 1) == 2u || getCell(ix, iy + 1) == 2u ||
        getCell(ix - 1, iy) == 2u || getCell(ix + 1, iy) == 2u) {
      gridOut[idx] = 5u; // become steam
      return;
    }
    // Fire dies randomly
    if (rand01 < 0.05) {
      gridOut[idx] = 0u;
      return;
    }
    // Fire rises
    if (isEmpty(ix, iy - 1) && rand01 < 0.6) {
      gridOut[idx] = 0u;
      return;
    }
    return;
  }

  // Stone: static
  if (cell == 4u) {
    return;
  }

  // Steam: rises and dissipates
  if (cell == 5u) {
    if (rand01 < 0.02) {
      gridOut[idx] = 0u; // dissipate
      return;
    }
    if (isEmpty(ix, iy - 1)) {
      gridOut[idx] = 0u;
      return;
    }
    if (goLeft && isEmpty(ix - 1, iy - 1)) { gridOut[idx] = 0u; return; }
    if (!goLeft && isEmpty(ix + 1, iy - 1)) { gridOut[idx] = 0u; return; }
    return;
  }
}
