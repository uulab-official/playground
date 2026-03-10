# Browser GPU Particle Simulator & Stress Test

## Overview
A web-based GPU stress test and physics sandbox built with WebGPU. This project combines the fun, emergent gameplay of "falling sand" simulators with the intense, scalable performance benchmarking of modern GPU stress tests. 

## Features
- **Particle Drop**: Gravity, bounce, friction simulations with up to 200k particles.
- **Falling Sand**: Elemental interactions between materials like water, fire, smoke, and acid.
- **Fluid Playground**: Compute shader-driven fluid dynamics.
- **Stress Test**: Benchmark your device's GPU performance with a customizable automated particle load.

## Tech Stack
- Frontend: `Vite`, `React`, `TypeScript`
- Rendering/Compute: `WebGPU`, `WGSL`, `WebGL2` fallback
- State Management: `Zustand`
- Data Visualization: `lightweight-charts`
- Deployment: `Cloudflare Pages` / `GitHub Pages`

## Development
See the `develop` branch for actual source code and implementation.

```bash
npm install
npm run dev
```
