# GPU Playground (Particle Lab)

A web-based GPU physics simulation playground and performance benchmarking tool built with WebGPU.

## Core Features
1. **Playground Modes**: 
   - **Particle Drop**: Render 10k-200k particles with gravity and collisions.
   - **Sandbox**: Elemental interactions (Sand, Water, Fire, Lava).
   - **Fluid & Chaos**: Advanced compute shader fluid dynamics and extreme stress testing.
2. **Benchmark Mode**: Test your device's capabilities (GPU, FPS, Frame Time) and generate shareable scorecards.
3. **Viral Tools**: 10-second clip recordings and extreme visual presets (Blackhole, Volcano).

## Tech Stack
- Frontend: Vite + React + TypeScript + Zustand
- GPU Compute & Render: WebGPU + WGSL
- Charts: lightweight-charts
- Deployment: Fully static, frontend-only deployment ready for Cloudflare Pages / GitHub Pages.

## Project Structure
```text
playground/
├── docs/                # Project architecture and IA definitions
├── public/              # Static assets
└── src/
    ├── components/      # React UI Components (e.g. WebGPUCanvas)
    ├── lib/             # WebGPU context utilities and helpers
    ├── shaders/         # WGSL compute and render shaders
    ├── stores/          # Zustand global state management
    ├── App.tsx          # Main application overlay and routing
    └── index.css        # Premium dark/light themes
```

## Running Locally

To run the application locally on the `develop` branch:

```bash
git checkout develop
npm install
npm run dev
```
