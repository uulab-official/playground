struct Params {
  width: u32,
  height: u32,
  isPaused: u32,
  padding: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> cellsIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellsOut: array<u32>;

fn getCell(x: i32, y: i32) -> u32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let wx = ((x % w) + w) % w;
  let wy = ((y % h) + h) % h;
  return cellsIn[u32(wy) * params.width + u32(wx)];
}

@compute @workgroup_size(16, 16)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;

  if (x >= params.width || y >= params.height) { return; }

  let idx = y * params.width + x;

  if (params.isPaused > 0u) {
    cellsOut[idx] = cellsIn[idx];
    return;
  }

  let ix = i32(x);
  let iy = i32(y);

  // Count neighbors
  var neighbors = 0u;
  neighbors += getCell(ix - 1, iy - 1);
  neighbors += getCell(ix,     iy - 1);
  neighbors += getCell(ix + 1, iy - 1);
  neighbors += getCell(ix - 1, iy);
  neighbors += getCell(ix + 1, iy);
  neighbors += getCell(ix - 1, iy + 1);
  neighbors += getCell(ix,     iy + 1);
  neighbors += getCell(ix + 1, iy + 1);

  let alive = cellsIn[idx];

  // Conway's rules
  if (alive == 1u) {
    if (neighbors == 2u || neighbors == 3u) {
      cellsOut[idx] = 1u;
    } else {
      cellsOut[idx] = 0u;
    }
  } else {
    if (neighbors == 3u) {
      cellsOut[idx] = 1u;
    } else {
      cellsOut[idx] = 0u;
    }
  }
}
