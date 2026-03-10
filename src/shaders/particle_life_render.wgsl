// Particle Life — Render (instanced point sprites, triangle-strip)

struct Particle {
  x:       f32,
  y:       f32,
  vx:      f32,
  vy:      f32,
  species: u32,
  pad1:    u32,
  pad2:    u32,
  pad3:    u32,
};

struct RenderParams {
  aspectRatio: f32,
  pointSize:   f32,
  pad1:        f32,
  pad2:        f32,
};

@group(0) @binding(0) var<uniform>       rp:        RenderParams;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VSOut {
  @builtin(position)                    pos:     vec4<f32>,
  @location(0)                          color:   vec3<f32>,
  @location(1) @interpolate(flat)       species: u32,
  @location(2)                          uv:      vec2<f32>,
};

fn speciesColor(s: u32) -> vec3<f32> {
  switch (s) {
    case 0u: { return vec3(1.0,  0.25, 0.25); }  // red
    case 1u: { return vec3(0.25, 1.0,  0.25); }  // green
    case 2u: { return vec3(0.25, 0.5,  1.0);  }  // blue
    case 3u: { return vec3(1.0,  0.9,  0.1);  }  // yellow
    case 4u: { return vec3(1.0,  0.25, 1.0);  }  // magenta
    default: { return vec3(0.1,  1.0,  0.9);  }  // cyan
  }
}

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let p = particles[iid];

  // Quad corner in [-1,1] from triangle-strip vertex index
  let quadX = f32(vid & 1u) * 2.0 - 1.0;
  let quadY = f32((vid >> 1u) & 1u) * 2.0 - 1.0;

  // Map [0,1] position to NDC; y=0 is top of screen
  let ndcX = p.x * 2.0 - 1.0;
  let ndcY = 1.0 - p.y * 2.0;

  let halfSize = rp.pointSize;
  let finalX = ndcX + quadX * halfSize / rp.aspectRatio;
  let finalY = ndcY + quadY * halfSize;

  var o: VSOut;
  o.pos     = vec4(finalX, finalY, 0.0, 1.0);
  o.color   = speciesColor(p.species);
  o.species = p.species;
  o.uv      = vec2(quadX, quadY);
  return o;
}

@fragment
fn fs_main(
  @location(0)                    color:   vec3<f32>,
  @location(1) @interpolate(flat) species: u32,
  @location(2)                    uv:      vec2<f32>,
) -> @location(0) vec4<f32> {
  let dist = length(uv);
  if (dist > 1.0) { discard; }
  let alpha = (1.0 - dist * dist) * 0.85;
  return vec4(color, alpha);
}
