'use client';

import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react';
import SimulationCanvas from './SimulationCanvas';
import { SimulationEngine } from '../lib/simulation/SimulationEngine';
import { GPUSimulationEngine } from '../lib/simulation/GPUSimulationEngine';
import { defaultConfig } from '../lib/simulation/simulationConfigs';

interface ParticleSimulationProps {
    engine: SimulationEngine | null;
    isInitialized: boolean;
    fps: number;
    setFps: (fps: number) => void;
    randomizeRules: () => void;
    reset: () => void;
    togglePause: () => void;
    onGpuReady?: () => void;
}

// Attach a ref to <ParticleSimulation> and call ref.current.injectFromScores(scores)
// from the parent — it will route to whichever engine is currently active.
export interface ParticleSimulationHandle {
    injectFromScores: (scores: Record<string, number>, headline?: string) => void;
}

export default forwardRef<ParticleSimulationHandle, ParticleSimulationProps>(
function ParticleSimulation({
    engine,
    isInitialized,
    fps,
    setFps,
    randomizeRules,
    reset: _reset,
    togglePause,
    onGpuReady,
}: ParticleSimulationProps, ref) {
    const [showStats, setShowStats] = useState(true);
    const [useGPU,    setUseGPU]    = useState(true); // start in GPU mode

    // GPU engine tracked in state so SimulationCanvas re-renders when it becomes
    // available (ref changes alone don't trigger renders).
    const [gpuEngine, setGpuEngine] = useState<GPUSimulationEngine | null>(null);

    // Ref mirrors state for imperative access inside event-handler closures and
    // useImperativeHandle — reads are always current even in stale closures.
    const gpuEngineRef = useRef<GPUSimulationEngine | null>(null);

    // Initialise the GPU engine shell as soon as the CPU engine prop becomes
    // available. SimulationCanvas's useEffect will call init(renderer) and
    // syncFromCPU() in the correct order once it mounts with a non-null gpuEngine.
    useEffect(() => {
        if (engine && !gpuEngineRef.current) {
            const g = new GPUSimulationEngine(engine.config);
            gpuEngineRef.current = g;
            setGpuEngine(g);
        }
    }, [engine]);

    // Route injection to whichever engine is currently live.
    // When GPU is active, GPUSimulationEngine.injectFromScores does:
    //   readback GPU → CPU inject → re-sync to GPU
    useImperativeHandle(ref, () => ({
        injectFromScores(scores: Record<string, number>, headline?: string) {
            if (useGPU && gpuEngineRef.current) {
                gpuEngineRef.current.injectFromScores(scores, headline);
            } else {
                engine?.injectFromScores(scores, headline);
            }
        },
    }), [useGPU, engine]);

    const handleToggleGPU = () => {
        const next = !useGPU;

        if (next && !gpuEngineRef.current) {
            const config = engine?.config ?? defaultConfig;
            const g = new GPUSimulationEngine(config);
            gpuEngineRef.current = g;
            setGpuEngine(g);
        }

        // Mirror pause state across engines
        if (engine?.paused !== undefined && gpuEngineRef.current) {
            if (engine.paused !== gpuEngineRef.current.paused) {
                gpuEngineRef.current.togglePause();
            }
        }

        setUseGPU(next);
    };

    const handleRandomize = () => {
        randomizeRules();                          // CPU engine
        gpuEngineRef.current?.randomizeRules();   // GPU engine (if it exists)
    };

    const handleTogglePause = () => {
        togglePause();
        gpuEngineRef.current?.togglePause();
    };

    // Stats always reflect whichever engine is actually running
    const activeEngine = (useGPU && gpuEngine) ? gpuEngine : engine;

    return (
        <div className="relative w-full h-full bg-black">
            {showStats && (
                <div className="absolute top-4 left-4 bg-black/70 text-white p-4 rounded-lg text-sm font-mono z-10">
                    <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>
                        {useGPU ? '🚀 GPU MODE' : '💻 CPU MODE'}
                    </div>
                    <div>Particles: {activeEngine ? activeEngine.activeParticleCount : 0} / {activeEngine?.config.particleCount || 0}</div>
                    <div>Queue depth: {activeEngine ? activeEngine.spawnQueue.length : 0}</div>
                    <div>FPS: {fps}</div>
                    <div style={{
                        color: fps >= 60 ? '#4CAF50' : fps >= 30 ? '#FFA500' : '#f44336',
                        fontWeight: 'bold',
                    }}>
                        {fps >= 60 ? '🟢 Excellent' : fps >= 30 ? '🟡 Good' : '🔴 Low'}
                    </div>
                </div>
            )}

            {isInitialized && (
                <SimulationCanvas
                    engine={engine}
                    gpuEngine={gpuEngine}
                    useGPU={useGPU}
                    onFpsUpdate={setFps}
                    onGpuReady={onGpuReady}
                />
            )}

            <div style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'rgba(0,0,0,0.8)',
                padding: '12px',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                zIndex: 10,
            }}>
                <button onClick={handleRandomize} style={buttonStyle}>
                    Randomize Rules
                </button>
                <button onClick={handleTogglePause} style={buttonStyle}>
                    Pause / Resume
                </button>

                <hr style={{ margin: '4px 0', borderColor: 'rgba(255,255,255,0.3)' }} />

                <button
                    onClick={handleToggleGPU}
                    style={{
                        ...buttonStyle,
                        background: useGPU
                            ? 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)'
                            : '#444',
                    }}
                >
                    {useGPU ? '🚀 GPU On' : '💻 GPU Off'}
                </button>

                <button onClick={() => setShowStats(s => !s)} style={buttonStyle}>
                    Toggle Stats
                </button>
            </div>
        </div>
    );
});

const buttonStyle: React.CSSProperties = {
    padding: '8px 12px',
    background: '#470ba2',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 'bold',
};
