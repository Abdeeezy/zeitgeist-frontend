'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ParticleRenderer } from '../lib/three/ParticleRenderer';
import { SimulationEngine } from '../lib/simulation/SimulationEngine';
import { GPUSimulationEngine } from '../lib/simulation/GPUSimulationEngine';

// ─── Fixed timestep constants ─────────────────────────────────────────────────
// The simulation always steps in exactly FIXED_DT_MS increments so biological
// tempo is identical on 30 FPS hardware and 144 FPS hardware.
const FIXED_DT_MS = 1000 / 30; // ~8.67ms → ~30 simulation steps per real second
const MAX_STEPS   = 5;          // prevents spiral-of-death on slow frames

interface SimulationCanvasProps {
    engine: SimulationEngine | null;
    gpuEngine?: GPUSimulationEngine | null;
    useGPU?: boolean;
    onFpsUpdate: (fps: number) => void;
    onGpuReady?: () => void;
}

export default function SimulationCanvas({
    engine,
    gpuEngine = null,
    useGPU = false,
    onFpsUpdate,
    onGpuReady,
}: SimulationCanvasProps) {
    const canvasRef         = useRef<HTMLCanvasElement>(null);
    const rendererRef       = useRef<ParticleRenderer | null>(null);
    const animationFrameRef = useRef<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        const cpuEng = engine;
        const gpuEng = gpuEngine;

        if (!canvas) return;
        if (useGPU  && !gpuEng) return;
        if (!useGPU && !cpuEng) return;

        const activeConfig = useGPU ? gpuEng!.config : cpuEng!.config;

        // WebGLRenderer is created here and shared with GPUSimulationEngine —
        // both GPGPU compute and Three.js scene rendering share one GL context.
        const threeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        threeRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
        threeRenderer.setPixelRatio(window.devicePixelRatio);

        const particleRenderer = new ParticleRenderer(
            canvas,
            activeConfig.numTypes,
            threeRenderer
        );
        rendererRef.current = particleRenderer;

        // Post-processing effects initialization 
        particleRenderer.initGlow(canvas.clientWidth, canvas.clientHeight, activeConfig.postProcessingGlowRadius, activeConfig.postProcessingGlowStrength);


        if (useGPU && gpuEng) {
            try {
                gpuEng.init(threeRenderer);
                if (cpuEng) gpuEng.syncFromCPU(cpuEng);
                particleRenderer.createGPUMesh(gpuEng);
                // Fire after GPU is fully initialised so callers can inject particles
                // knowing they will go through the correct GPU path (readback → CPU → sync).
                onGpuReady?.();
            } catch (err) {
                console.error('GPU init failed — falling back to CPU:', err);
                particleRenderer.createParticleMeshes(activeConfig.numTypes, activeConfig.particleSize);
            }
        } else {
            particleRenderer.createParticleMeshes(activeConfig.numTypes, activeConfig.particleSize);
        }

        const controls = new OrbitControls(particleRenderer.camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;

        // ── Fixed timestep state ──────────────────────────────────────────────
        let lastTime    = performance.now();
        let accumulator = 0; // ms of unprocessed real time
        let frames      = 0;
        let fpsTime     = 0;

        const animate = () => {
            const now   = performance.now();
            // Clamp to 100ms max to survive tab-switch / debugger pauses
            const delta = Math.min(now - lastTime, 100);
            lastTime    = now;

            frames++;
            fpsTime += delta;
            if (fpsTime >= 1000) {
                onFpsUpdate(frames);
                frames  = 0;
                fpsTime = 0;
            }

            // ── Accumulator loop ──────────────────────────────────────────────
            // Real elapsed time is accumulated and consumed in fixed FIXED_DT_MS
            // chunks. The simulation advances the same simulated time per real
            // second regardless of whether the GPU runs at 30 or 144 FPS.
            accumulator += delta;
            let steps = 0;

            while (accumulator >= FIXED_DT_MS && steps < MAX_STEPS) {
                if (useGPU && gpuEng) {
                    gpuEng.update();
                } else if (cpuEng) {
                    cpuEng.update();
                }
                accumulator -= FIXED_DT_MS;
                steps++;
            }

            // If MAX_STEPS hit, discard remainder to prevent unbounded growth
            if (steps === MAX_STEPS) accumulator = 0;

            // Render once per animation frame — decoupled from simulation steps
            if (useGPU && gpuEng) {
                particleRenderer.updateParticles(gpuEng);
            } else if (cpuEng) {
                particleRenderer.updateParticles(cpuEng);
            }

            controls.update();
            particleRenderer.render();

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animate();

        const handleResize = () => {
            if (!canvas.parentElement) return;
            particleRenderer.resize(
                canvas.parentElement.clientWidth,
                canvas.parentElement.clientHeight
            );
            particleRenderer.initGlow(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight, activeConfig.postProcessingGlowRadius, activeConfig.postProcessingGlowStrength)
        };
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameRef.current);
            controls.dispose();
            if (useGPU && gpuEng) gpuEng.dispose();
            particleRenderer.dispose();
        };

    }, [engine, gpuEngine, useGPU, onFpsUpdate]);

    return <canvas ref={canvasRef} className="w-full h-full" />;
}
