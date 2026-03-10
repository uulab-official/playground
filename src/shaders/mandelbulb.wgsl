// Mandelbulb 3D — Real-time ray marching on GPU

struct Params {
  width:     u32,
  height:    u32,
  time:      f32,
  power:     f32,
  camTheta:  f32,
  camPhi:    f32,
  camDist:   f32,
  colorMode: u32,
};

@group(0) @binding(0) var<uniform> params: Params;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0)       uv:  vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var corners = array<vec2<f32>, 4>(
    vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(1., 1.)
  );
  var o: VSOut;
  o.pos = vec4(corners[vid], 0., 1.);
  o.uv  = corners[vid];
  return o;
}

// Mandelbulb distance estimator — returns (distance, orbit_trap)
fn mbDE(pos: vec3<f32>) -> vec2<f32> {
  let pw = params.power;
  var z    = pos;
  var dr   = 1.0;
  var r    = 0.0;
  var trap = 1e10;

  for (var i = 0; i < 14; i++) {
    r = length(z);
    if (r > 2.0) { break; }

    trap = min(trap, dot(z, z));

    let theta = acos(clamp(z.z / r, -1.0, 1.0));
    let phi   = atan2(z.y, z.x);
    dr = pow(r, pw - 1.0) * pw * dr + 1.0;

    let zr = pow(r, pw);
    let t  = theta * pw;
    let p  = phi   * pw;
    z = zr * vec3<f32>(sin(t) * cos(p), sin(t) * sin(p), cos(t)) + pos;
  }

  r = length(z);
  return vec2(0.5 * log(r) * r / dr, sqrt(trap));
}

fn sdf(p: vec3<f32>) -> f32 { return mbDE(p).x; }

fn calcNormal(p: vec3<f32>) -> vec3<f32> {
  let e = 0.0006;
  return normalize(vec3<f32>(
    sdf(p + vec3( e, 0., 0.)) - sdf(p - vec3( e, 0., 0.)),
    sdf(p + vec3(0.,  e, 0.)) - sdf(p - vec3(0.,  e, 0.)),
    sdf(p + vec3(0., 0.,  e)) - sdf(p - vec3(0., 0.,  e)),
  ));
}

fn softShadow(ro: vec3<f32>, rd: vec3<f32>, mint: f32, maxt: f32, k: f32) -> f32 {
  var sh = 1.0;
  var t  = mint;
  for (var i = 0; i < 20; i++) {
    let h = sdf(ro + rd * t);
    sh = min(sh, k * h / t);
    t += clamp(h, 0.03, 0.5);
    if (sh < 0.001 || t > maxt) { break; }
  }
  return clamp(sh, 0.0, 1.0);
}

fn calcAO(p: vec3<f32>, n: vec3<f32>) -> f32 {
  var ao    = 0.0;
  var scale = 1.0;
  for (var i = 1; i <= 5; i++) {
    let h = f32(i) * 0.08;
    ao   += scale * (h - max(sdf(p + n * h), 0.0));
    scale *= 0.55;
  }
  return clamp(1.0 - 2.5 * ao, 0.0, 1.0);
}

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

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let aspect = f32(params.width) / f32(params.height);

  // Camera (spherical)
  let theta = params.camTheta;
  let phi   = params.camPhi;
  let dist  = params.camDist;

  let ro = dist * vec3<f32>(cos(phi) * cos(theta), sin(phi), cos(phi) * sin(theta));
  let fwd   = normalize(-ro);
  let right = normalize(cross(fwd, vec3<f32>(0., 1., 0.)));
  let camUp = cross(right, fwd);

  let rd = normalize(fwd + uv.x * aspect * right * 0.55 + uv.y * camUp * 0.55);

  // Ray march
  var t    = 0.3;
  var hit  = false;
  var trap = 1.0;

  for (var i = 0; i < 160; i++) {
    let p   = ro + rd * t;
    let res = mbDE(p);
    let d   = res.x;
    if (d < 0.00018 * t) { hit = true; trap = res.y; break; }
    if (t > 6.0)          { break; }
    t += d * 0.88;
  }

  var color = vec3<f32>(0.0);

  if (hit) {
    let p = ro + rd * t;
    let n = calcNormal(p);

    let keyLight  = normalize(vec3<f32>(1.5, 2.0, 1.0));
    let fillLight = normalize(vec3<f32>(-1.0, 0.3, -0.5));

    let shadow = softShadow(p + n * 0.004, keyLight, 0.01, 3.0, 8.0);
    let ao     = calcAO(p, n);

    let diff  = max(dot(n, keyLight), 0.0);
    let fill  = max(dot(n, fillLight), 0.0) * 0.25;
    let amb   = 0.06;
    let light = (diff * shadow + fill + amb) * ao;

    var baseColor: vec3<f32>;
    if (params.colorMode == 0u) {
      // Orbit trap rainbow
      let hue = fract(trap * 1.2 + params.time * 0.04);
      baseColor = hsv2rgb(hue, 0.9, 1.0);
    } else if (params.colorMode == 1u) {
      // Normal-based pastel
      baseColor = n * 0.5 + 0.5;
      baseColor = pow(baseColor, vec3(0.6));
    } else {
      // Depth warm/cool
      let d2 = clamp((t - 1.0) / 3.5, 0.0, 1.0);
      baseColor = mix(vec3(1.0, 0.6, 0.1), vec3(0.05, 0.2, 0.9), d2);
    }

    let h2   = normalize(keyLight - rd);
    let spec = pow(max(dot(n, h2), 0.0), 80.0) * 0.5 * shadow;

    color = baseColor * light + vec3(spec * 0.8);
    color = color / (color + 1.0);
    color = pow(color, vec3(1.0 / 2.2));
  } else {
    let bg = max(dot(rd, normalize(vec3(0., 1., 0.))) * 0.5 + 0.5, 0.0);
    color  = mix(vec3(0.008, 0.008, 0.015), vec3(0.03, 0.04, 0.09), bg * bg);

    // Stars
    let starUV  = rd.xy * 200.0;
    let starCell = fract(starUV);
    let starId   = floor(starUV);
    let starHash = fract(sin(dot(starId, vec2(127.1, 311.7))) * 43758.5453);
    if (starHash > 0.995) {
      let brightness = fract(starHash * 100.0);
      color += vec3(brightness * 0.4);
    }
  }

  return vec4<f32>(color, 1.0);
}
