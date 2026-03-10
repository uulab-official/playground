struct Params {
  time: f32,
  aspectRatio: f32,
  cameraAngleX: f32,
  cameraAngleY: f32,
  cameraZoom: f32,
  sceneId: f32,      // 0=spheres, 1=menger, 2=torus-knot, 3=terrain
  fogDensity: f32,
  padding: f32,
};

@group(0) @binding(0) var<uniform> params: Params;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0)
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vid], 0.0, 1.0);
  out.uv = pos[vid];
  return out;
}

fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
  return length(p) - r;
}

fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdTorus(p: vec3<f32>, t: vec2<f32>) -> f32 {
  let q = vec2<f32>(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

fn rotX(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a); let s = sin(a);
  return vec3<f32>(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
}

fn opSmoothUnion(d1: f32, d2: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// Scene 0: Metaballs
fn sceneMetaballs(p: vec3<f32>) -> f32 {
  let t = params.time * 0.8;
  let s1 = sdSphere(p - vec3<f32>(sin(t) * 1.2, cos(t * 0.7) * 0.5, cos(t) * 0.8), 0.6);
  let s2 = sdSphere(p - vec3<f32>(cos(t * 0.8) * 0.9, sin(t * 1.1) * 0.6, sin(t * 0.6) * 1.1), 0.5);
  let s3 = sdSphere(p - vec3<f32>(sin(t * 0.5) * 0.7, cos(t * 0.9) * 0.8, cos(t * 1.3) * 0.5), 0.45);
  let s4 = sdSphere(p, 0.3);
  var d = opSmoothUnion(s1, s2, 0.5);
  d = opSmoothUnion(d, s3, 0.5);
  d = opSmoothUnion(d, s4, 0.5);
  // Floor
  let floor = p.y + 1.5;
  d = min(d, floor);
  return d;
}

// Scene 1: Menger sponge
fn sceneMenger(p: vec3<f32>) -> f32 {
  var d = sdBox(p, vec3<f32>(1.0));
  var s = 1.0;
  for (var i = 0; i < 4; i++) {
    let a = (p * s % 2.0) - 1.0;
    s *= 3.0;
    let r = abs(1.0 - 3.0 * abs(a));
    let da = max(r.x, r.y);
    let db = max(r.y, r.z);
    let dc = max(r.z, r.x);
    let c = (min(da, min(db, dc)) - 1.0) / s;
    d = max(d, c);
  }
  return d;
}

// Scene 2: Multi torus
fn sceneTorusKnot(p: vec3<f32>) -> f32 {
  let t = params.time * 0.3;
  let p1 = rotY(rotX(p, t), t * 0.7);
  let d1 = sdTorus(p1, vec2<f32>(1.0, 0.3));
  let p2 = rotX(rotY(p, t * 1.1), t * 0.5);
  let d2 = sdTorus(p2, vec2<f32>(1.0, 0.25));
  return opSmoothUnion(d1, d2, 0.3);
}

// Scene 3: terrain
fn sceneTerrain(p: vec3<f32>) -> f32 {
  let h = sin(p.x * 2.0 + params.time) * 0.3
        + sin(p.z * 1.5 + params.time * 0.5) * 0.4
        + sin(p.x * 0.5 + p.z * 0.7) * 0.6;
  return p.y - h + 0.5;
}

fn sdf(p: vec3<f32>) -> f32 {
  let scene = u32(params.sceneId);
  if (scene == 0u) { return sceneMetaballs(p); }
  if (scene == 1u) {
    let rp = rotY(rotX(p, params.time * 0.2), params.time * 0.15);
    return sceneMenger(rp);
  }
  if (scene == 2u) { return sceneTorusKnot(p); }
  return sceneTerrain(p);
}

fn calcNormal(p: vec3<f32>) -> vec3<f32> {
  let e = 0.001;
  return normalize(vec3<f32>(
    sdf(p + vec3<f32>(e, 0.0, 0.0)) - sdf(p - vec3<f32>(e, 0.0, 0.0)),
    sdf(p + vec3<f32>(0.0, e, 0.0)) - sdf(p - vec3<f32>(0.0, e, 0.0)),
    sdf(p + vec3<f32>(0.0, 0.0, e)) - sdf(p - vec3<f32>(0.0, 0.0, e))
  ));
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let coord = vec2<f32>(uv.x * params.aspectRatio, uv.y);

  // Camera
  let camDist = 3.5 / params.cameraZoom;
  let camPos = vec3<f32>(
    sin(params.cameraAngleX) * cos(params.cameraAngleY) * camDist,
    sin(params.cameraAngleY) * camDist + 0.5,
    cos(params.cameraAngleX) * cos(params.cameraAngleY) * camDist
  );
  let target = vec3<f32>(0.0, 0.0, 0.0);
  let fwd = normalize(target - camPos);
  let right = normalize(cross(fwd, vec3<f32>(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);

  let rd = normalize(fwd * 2.0 + right * coord.x + up * coord.y);

  // Ray march
  var t = 0.0;
  var hit = false;
  for (var i = 0; i < 128; i++) {
    let p = camPos + rd * t;
    let d = sdf(p);
    if (d < 0.001) { hit = true; break; }
    if (t > 50.0) { break; }
    t += d;
  }

  if (!hit) {
    // Sky gradient
    let sky = mix(
      vec3<f32>(0.02, 0.02, 0.05),
      vec3<f32>(0.05, 0.03, 0.15),
      uv.y * 0.5 + 0.5
    );
    return vec4<f32>(sky, 1.0);
  }

  let p = camPos + rd * t;
  let n = calcNormal(p);

  // Lighting
  let lightDir = normalize(vec3<f32>(0.6, 0.8, -0.4));
  let diff = max(dot(n, lightDir), 0.0);
  let halfDir = normalize(lightDir - rd);
  let spec = pow(max(dot(n, halfDir), 0.0), 32.0);
  let ambient = 0.08;

  // Material color based on normal
  let baseColor = vec3<f32>(
    0.4 + n.x * 0.3,
    0.3 + n.y * 0.4,
    0.6 + n.z * 0.2
  );

  var col = baseColor * (diff * 0.7 + ambient) + vec3<f32>(1.0) * spec * 0.4;

  // Fog
  let fog = 1.0 - exp(-t * params.fogDensity);
  col = mix(col, vec3<f32>(0.02, 0.02, 0.05), fog);

  // Gamma
  col = pow(col, vec3<f32>(0.8));

  return vec4<f32>(col, 1.0);
}
