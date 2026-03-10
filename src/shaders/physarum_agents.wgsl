// Physarum polycephalum — agent movement compute shader
struct Agent {
  x: f32,
  y: f32,
  angle: f32,
  pad: f32,
};

struct Params {
  width:         u32,   // [0]
  height:        u32,   // [1]
  agentCount:    u32,   // [2]
  frame:         u32,   // [3]
  sensorAngle:   f32,   // [4]
  sensorDist:    f32,   // [5]
  rotateAngle:   f32,   // [6]
  speed:         f32,   // [7]
  depositAmount: f32,   // [8]
  pad1:          f32,   // [9]
  pad2:          f32,   // [10]
  pad3:          f32,   // [11]
};

@group(0) @binding(0) var<uniform>            params:    Params;
@group(0) @binding(1) var<storage, read>      agents_in: array<Agent>;
@group(0) @binding(2) var<storage, read_write> agents_out: array<Agent>;
@group(0) @binding(3) var<storage, read_write> trailMap: array<atomic<u32>>;

fn hash(v: u32) -> u32 {
  var x = v;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return x;
}

fn sampleTrail(tx: i32, ty: i32) -> f32 {
  let w = i32(params.width);
  let h = i32(params.height);
  let cx = clamp(tx, 0, w - 1);
  let cy = clamp(ty, 0, h - 1);
  let value = atomicLoad(&trailMap[u32(cy) * params.width + u32(cx)]);
  return f32(value) / 1000.0;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.agentCount) { return; }

  let agent = agents_in[idx];
  var x     = agent.x;
  var y     = agent.y;
  var angle = agent.angle;

  let sa = params.sensorAngle;
  let sd = params.sensorDist;
  let ra = params.rotateAngle;

  // Sense forward / left / right
  let fwdX = x + cos(angle)        * sd;
  let fwdY = y + sin(angle)        * sd;
  let lftX = x + cos(angle + sa)   * sd;
  let lftY = y + sin(angle + sa)   * sd;
  let rgtX = x + cos(angle - sa)   * sd;
  let rgtY = y + sin(angle - sa)   * sd;

  let fwd = sampleTrail(i32(fwdX), i32(fwdY));
  let lft = sampleTrail(i32(lftX), i32(lftY));
  let rgt = sampleTrail(i32(rgtX), i32(rgtY));

  // Steering
  if (fwd >= lft && fwd >= rgt) {
    // No turn — keep going straight
  } else if (fwd < lft && fwd < rgt) {
    // Random turn
    let rng = hash(idx + params.frame * 1234u);
    if ((rng & 1u) == 0u) {
      angle = angle + ra;
    } else {
      angle = angle - ra;
    }
  } else if (rgt > lft) {
    angle = angle - ra;
  } else {
    angle = angle + ra;
  }

  // Move
  var nx = x + cos(angle) * params.speed;
  var ny = y + sin(angle) * params.speed;

  let fw = f32(params.width);
  let fh = f32(params.height);

  // Bounce off walls (reflect angle component-wise)
  if (nx < 0.0) {
    nx = 0.0;
    angle = 3.14159265 - angle;
  } else if (nx >= fw) {
    nx = fw - 0.001;
    angle = 3.14159265 - angle;
  }
  if (ny < 0.0) {
    ny = 0.0;
    angle = -angle;
  } else if (ny >= fh) {
    ny = fh - 0.001;
    angle = -angle;
  }

  // Deposit trail at new position
  let tx = u32(nx);
  let ty = u32(ny);
  let tidx = ty * params.width + tx;
  atomicAdd(&trailMap[tidx], u32(params.depositAmount * 1000.0));

  agents_out[idx] = Agent(nx, ny, angle, 0.0);
}
