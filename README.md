# Zeitgeist Engine

A GPU-accelerated n-body particle simulation driven by thematic analysis of news articles.

![Zeitgeist Engine](docs/screenshot.png)

## Overview

The Zeitgeist Engine visualizes the "spirit of the times" by transforming news articles into an interactive 3D particle simulation. Each of the 27 particle types represents a thematic concept (Renewal, Compassion, Entropy, Tyranny, etc.) organized into a moral hierarchy of Good, Neutral, and Evil alignments.

Particle interactions are governed by a **semantic attraction matrix** — not random — derived from:
- **Moral alignment**: good attracts good, evil attracts evil, opposites repel
- **Hierarchical proximity**: sibling themes cluster together
- **Narrative overrides**: specific dramatic relationships (e.g. Void is drawn to Potential, but Potential flees Void)

The simulation runs entirely on the GPU via WebGL compute shaders (GPGPU), supporting 22,500+ particles at 60fps.

## Architecture

```
zeitgeist-engine/
├── src/app/
│   ├── api/articles-backup/   # Next.js API route — Upstash Redis persistence
│   ├── components/            # React components
│   │   ├── ParticleSimulation.tsx   # Main simulation wrapper (CPU/GPU toggle)
│   │   ├── SimulationCanvas.tsx     # Three.js canvas + fixed-timestep loop
│   │   ├── ThemeStatBoard.tsx       # Stats dashboard + attraction matrix viz
│   │   └── ServerStatusBlock.tsx    # Processor server status indicator
│   ├── hooks/
│   │   └── useSimulation.ts         # React hook for simulation lifecycle
│   ├── lib/
│   │   ├── simulation/
│   │   │   ├── SimulationEngine.ts       # CPU engine (spatial hashing)
│   │   │   ├── GPUSimulationEngine.ts    # GPU engine (GPGPU compute)
│   │   │   ├── attractionMatrix.ts       # Semantic attraction matrix builder
│   │   │   ├── simulationConfigs.ts      # Default configuration
│   │   │   ├── typeColors.ts             # Color palettes
│   │   │   └── types.ts                  # TypeScript interfaces
│   │   └── three/
│   │       └── ParticleRenderer.ts       # Three.js rendering + post-processing glow
│   ├── page.tsx               # Main page
│   ├── layout.tsx             # Root layout
│   └── globals.css            # Global styles
```


## To-Do
- CPU-mode should truncate the amount of rendered particles to a maximum of 2000 particles. (CPU processing is extremely slow relative to the GPUs capabilities..)
    - Should do so in a way that maintains the ratio-profile of the particle-types.  


## Setup

### Prerequisites
- Node.js 18+
- An [Upstash Redis](https://upstash.com) database (free tier works)
- The [processor server](link-to-your-processor-repo) running locally or deployed

### Installation

```bash
git clone https://github.com/YOUR_USERNAME/zeitgeist-engine.git
cd zeitgeist-engine
npm install
```

### Environment Variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env.local
```

Required variables:
| Variable | Description |
|----------|-------------|
| `redis_KV_REST_API_URL` | Upstash Redis REST URL |
| `redis_KV_REST_API_TOKEN` | Upstash Redis REST token |
| `NEXT_PUBLIC_PROCESSOR_API_URL` | Processor server URL (defaults to `http://127.0.0.1:8000`) |

### Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Deploy to Vercel

```bash
npx vercel
```

Set the environment variables in your Vercel project settings.

## How It Works

1. **Data pipeline** (separate repo): Scrapes news → NLP theme scoring → serves via REST API
2. **Injection**: The front-end fetches scored articles and spawns particles proportional to each theme's score
3. **Simulation**: Particles interact via the attraction matrix. GPU mode runs the physics in GLSL fragment shaders using `GPUComputationRenderer`
4. **Persistence**: Injected articles are backed up to Upstash Redis so the simulation auto-restores on page load
5. **Rendering**: Three.js renders particles with a post-processing glow bloom effect

## License

MIT
