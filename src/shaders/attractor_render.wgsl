// Strange Attractor — Render (instanced point sprites)

struct RenderParams {
  camTheta:      f32,
  camPhi:        f32,
  camDist:       f32,
  time:          f32,
  width:         u32,
  height:        u32,
  attractorType: u32,
  colorMode:     u32,
};

struct Particle {
  x: f32, y: f32, z: f32,
  speed: f32,
};

@group(0) @binding(0) var<uniform>       params:    RenderParams;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VSOut {
  @builtin(position) pos:   vec4<f32>,
  @location(0)       color: vec3<f32>,
  @location(1)       uv:    vec2<f32>,
};

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let c  = v * s;
  let hp = h * 6.0;
  let x  = c * (1.0 - abs(hp % 2.0 - 1.0));
  let m  = v - c;
  var rgb: vec3<f32>;
  if      (hp < 1.0) { rgb = vec3(c, x, 0.); }
  else if (hp < 2.0) { rgb = vec3(x, c, 0.); }
  else if (hp < 3.0) { rgb = vec3(0., c, x); }
  else if (hp < 4.0) { rgb = vec3(0., x, c); }
  else if (hp < 5.0) { rgb = vec3(x, 0., c); }
  else               { rgb = vec3(c, 0., x); }
  return rgb + m;
}

// Normalize position per attractor type
fn normPos(p: vec3<f32>, t: u32) -> vec3<f32> {
  if (t == 0u) { return p / 25.0; }   // Lorenz  ≈ ±25
  if (t == 1u) { return p * 0.35; }   // Thomas  ≈ ±3
  if (t == 2u) { return p / 12.0; }   // Halvorsen ≈ ±12
  return p * 2.0;                       // Aizawa ≈ ±0.5
}

// Max speed per attractor (for color normalization)
fn maxSpeed(t: u32) -> f32 {
  if (t == 0u) { return 80.0; }
  if (t == 1u) { return 2.0; }
  if (t == 2u) { return 20.0; }
  return 2.0;
}

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p  = particles[iid];
  let np = normPos(vec3(p.x, p.y, p.z), params.attractorType);

  // Camera
  let theta = params.camTheta;
  let phi   = params.camPhi;
  let dist  = params.camDist;
  let eye   = dist * vec3(cos(phi)*cos(theta), sin(phi), cos(phi)*sin(theta));
  let fwd   = normalize(-eye);
  let right = normalize(cross(fwd, vec3(0., 1., 0.)));
  let up    = cross(right, fwd);

  // View space
  let toP = np - eye;
  let vx  = dot(toP, right);
  let vy  = dot(toP, up);
  let vz  = dot(toP, fwd);

  let aspect = f32(params.width) / f32(params.height);
  let fov    = 1.0;

  // Clip behind camera
  var ndcX = 2.0;
  var ndcY = 2.0;
  if (vz > 0.001) {
    ndcX = vx / vz * fov / aspect;
    ndcY = vy / vz * fov;
  }

  // Point sprite corners
  var corners = array<vec2<f32>, 4>(
    vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(1., 1.)
  );
  let corner = corners[vid];
  let size   = 0.0018;

  // Color by speed
  let sNorm = clamp(p.speed / maxSpeed(params.attractorType), 0.0, 1.0);
  var hue: f32;
  if (params.colorMode == 0u) {
    hue = 0.67 - sNorm * 0.67;   // blue→red
  } else if (params.colorMode == 1u) {
    hue = fract(sNorm * 0.5 + params.time * 0.02);  // animated
  } else {
    // Position-based
    hue = fract(np.x * 0.5 + np.y * 0.3 + np.z * 0.2 + 0.5);
  }
  let rgb = hsv2rgb(hue, 0.9, 1.0);

  var o: VSOut;
  o.pos   = vec4(ndcX + corner.x * size, ndcY + corner.y * size, 0.5, 1.0);
  o.color = rgb;
  o.uv    = corner;
  return o;
}

@fragment
fn fs_main(@location(0) color: vec3<f32>, @location(1) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let d = dot(uv, uv);
  if (d > 1.0) { discard; }
  let alpha = (1.0 - d) * (1.0 - d) * 0.6;
  return vec4(color, alpha);
}
