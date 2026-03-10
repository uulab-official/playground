struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

struct BoidInstance {
  @location(0) pos: vec2<f32>,
  @location(1) vel: vec2<f32>,
};

struct RenderParams {
  aspectRatio: f32,
  boidSize: f32,
  padding1: f32,
  padding2: f32,
};

@group(0) @binding(0) var<uniform> params: RenderParams;

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  boid: BoidInstance
) -> VertexOutput {
  // Triangle pointing in velocity direction
  let speed = length(boid.vel);
  var dir = vec2<f32>(1.0, 0.0);
  if (speed > 0.001) {
    dir = normalize(boid.vel);
  }
  let perp = vec2<f32>(-dir.y, dir.x);

  let size = params.boidSize;
  // 3 vertices for a triangle
  var offsets = array<vec2<f32>, 3>(
    dir * size * 2.0,              // tip (forward)
    perp * size * -0.7 - dir * size, // left back
    perp * size * 0.7 - dir * size,  // right back
  );

  var output: VertexOutput;
  var offset = offsets[vid];
  offset.x /= params.aspectRatio;
  output.position = vec4<f32>(boid.pos + offset, 0.0, 1.0);

  // Color based on direction
  let angle = atan2(dir.y, dir.x);
  let hue = (angle / 6.2832) + 0.5;
  // Simple HSV to RGB
  let h = fract(hue) * 6.0;
  let f = fract(h);
  let q = 1.0 - f;
  let hi = u32(h) % 6u;
  var col: vec3<f32>;
  if (hi == 0u) { col = vec3<f32>(1.0, f, 0.0); }
  else if (hi == 1u) { col = vec3<f32>(q, 1.0, 0.0); }
  else if (hi == 2u) { col = vec3<f32>(0.0, 1.0, f); }
  else if (hi == 3u) { col = vec3<f32>(0.0, q, 1.0); }
  else if (hi == 4u) { col = vec3<f32>(f, 0.0, 1.0); }
  else { col = vec3<f32>(1.0, 0.0, q); }

  let brightness = 0.6 + speed * 0.8;
  output.color = vec4<f32>(col * brightness, 0.9);

  return output;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
