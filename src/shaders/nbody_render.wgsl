// Body struct same as compute
struct Body {
  x: f32, y: f32, vx: f32, vy: f32,
  mass: f32, pad1: f32, pad2: f32, pad3: f32,
}

struct RenderParams {
  bodyCount: u32, colorMode: u32, pointSize: f32, pad: f32,
}

@group(0) @binding(0) var<uniform> rp: RenderParams;
@group(0) @binding(1) var<storage, read> bodies: array<Body>;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32,
  @location(2) mass: f32,
}

@vertex fn vs_main(
  @builtin(vertex_index)    vid: u32,
  @builtin(instance_index)  iid: u32,
) -> VOut {
  let b = bodies[iid];
  var offsets = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
  );
  let local = offsets[vid];
  let size = rp.pointSize * (0.7 + b.mass * 0.5);
  let ndcX = b.x + local.x * size;
  let ndcY = b.y + local.y * size;
  let speed = sqrt(b.vx * b.vx + b.vy * b.vy);
  return VOut(vec4<f32>(ndcX, ndcY, 0.0, 1.0), local, speed, b.mass);
}

@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let r = length(in.localPos);
  if (r > 1.0) { discard; }
  let alpha = (1.0 - r * r) * 0.85;

  var color: vec3<f32>;
  switch rp.colorMode {
    case 1u: {
      // Speed: blue(slow) → orange(fast)
      let t = clamp(in.speed * 8.0, 0.0, 1.0);
      color = mix(vec3<f32>(0.1, 0.3, 0.9), vec3<f32>(1.0, 0.5, 0.05), t);
    }
    case 2u: {
      // Mass: small=cyan, large=yellow
      let t = clamp(in.mass / 3.0, 0.0, 1.0);
      color = mix(vec3<f32>(0.3, 0.9, 1.0), vec3<f32>(1.0, 0.9, 0.1), t);
    }
    default: {
      // Classic white-blue stars
      color = vec3<f32>(0.85, 0.90, 1.0);
    }
  }
  return vec4<f32>(color, alpha);
}
