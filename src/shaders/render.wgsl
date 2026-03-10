struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

// Information passed per instance (particle)
struct ParticleInstance {
  @location(0) pos: vec2<f32>,
  @location(1) vel: vec2<f32>,
  // Add other properties later like color/type
};

@vertex
fn vs_main(
  @builtin(vertex_index) VertexIndex : u32,
  instance: ParticleInstance
) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var output : VertexOutput;
  // Size of the particle. Later this can be uniform or per-particle.
  let particleSize = 4.0; 
  // Map canvas coordinate (0 to width) to NDC (-1 to 1) 
  // We will pass aspect or resolution uniform later, but for MVP keep it simple 
  // Assumes canvas coords passed in instances are already normalized NDC or we apply matrix
  // For now, let's assume `instance.pos` is in NDC (-1 to 1)

  output.position = vec4<f32>(instance.pos + pos[VertexIndex] * 0.005, 0.0, 1.0);
  
  // Base color logic (can be based on velocity scalar)
  let speed = length(instance.vel);
  let r = clamp(speed * 0.1, 0.2, 1.0);
  
  output.color = vec4<f32>(r, 0.5, 1.0 - r, 1.0);
  
  return output;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
