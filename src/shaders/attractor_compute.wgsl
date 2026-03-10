// Strange Attractor — GPU Compute (Lorenz / Thomas / Halvorsen)

struct Params {
  particleCount: u32,
  attractorType: u32,  // 0=Lorenz  1=Thomas  2=Halvorsen
  dt:            f32,
  frame:         u32,
};

struct Particle {
  x: f32, y: f32, z: f32,
  speed: f32,
};

@group(0) @binding(0) var<uniform>           params:       Params;
@group(0) @binding(1) var<storage, read>     particlesIn:  array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesOut: array<Particle>;

fn lorenz(p: vec3<f32>) -> vec3<f32> {
  let s = 10.0; let r = 28.0; let b = 2.6667;
  return vec3(s * (p.y - p.x), p.x * (r - p.z) - p.y, p.x * p.y - b * p.z);
}

fn thomas(p: vec3<f32>) -> vec3<f32> {
  let b = 0.19;
  return vec3(sin(p.y) - b * p.x, sin(p.z) - b * p.y, sin(p.x) - b * p.z);
}

fn halvorsen(p: vec3<f32>) -> vec3<f32> {
  let a = 1.4;
  return vec3(
    -a*p.x - 4.*p.y - 4.*p.z - p.y*p.y,
    -a*p.y - 4.*p.z - 4.*p.x - p.z*p.z,
    -a*p.z - 4.*p.x - 4.*p.y - p.x*p.x,
  );
}

fn aizawa(p: vec3<f32>) -> vec3<f32> {
  // a=0.95 b=0.7 c=0.6 d=3.5 e=0.25 f=0.1
  return vec3(
    (p.z - 0.7) * p.x - 3.5 * p.y,
    3.5 * p.x + (p.z - 0.7) * p.y,
    0.6 + 0.95 * p.z - p.z * p.z * p.z / 3.0 - (p.x*p.x + p.y*p.y) * (1.0 + 0.25 * p.z) + 0.1 * p.z * p.x * p.x * p.x,
  );
}

fn deriv(p: vec3<f32>) -> vec3<f32> {
  if (params.attractorType == 0u) { return lorenz(p); }
  if (params.attractorType == 1u) { return thomas(p); }
  if (params.attractorType == 2u) { return halvorsen(p); }
  return aizawa(p);
}

fn hash(n: u32) -> f32 {
  var x = n;
  x = x ^ (x >> 16u);
  x = x * 0x45d9f3bu;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967295.0;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let pin = particlesIn[i];
  var pos = vec3(pin.x, pin.y, pin.z);

  // Re-seed particles that have escaped or on first frame
  let escaped = any(abs(pos) > vec3(200.0));
  let seed = params.frame == 0u || escaped;
  if (seed) {
    // Initialize near attractor with small random perturbation
    let h1 = hash(i * 3u + 0u) * 2.0 - 1.0;
    let h2 = hash(i * 3u + 1u) * 2.0 - 1.0;
    let h3 = hash(i * 3u + 2u) * 2.0 - 1.0;
    if (params.attractorType == 0u) {
      pos = vec3(h1, h2, 25.0 + h3 * 2.0);
    } else if (params.attractorType == 1u) {
      pos = vec3(h1 * 0.5, h2 * 0.5, h3 * 0.5);
    } else if (params.attractorType == 2u) {
      pos = vec3(-5.0 + h1, h2, h3);
    } else {
      pos = vec3(h1 * 0.5, h2 * 0.5, 0.0);
    }
    particlesOut[i] = Particle(pos.x, pos.y, pos.z, 0.0);
    return;
  }

  // RK4 integration
  let dt = params.dt;
  let k1 = deriv(pos);
  let k2 = deriv(pos + k1 * (dt * 0.5));
  let k3 = deriv(pos + k2 * (dt * 0.5));
  let k4 = deriv(pos + k3 * dt);
  let vel = (k1 + 2.0*k2 + 2.0*k3 + k4) * (1.0/6.0);

  pos += vel * dt;
  let speed = length(vel);

  particlesOut[i] = Particle(pos.x, pos.y, pos.z, speed);
}
