'use client';

import { useEffect, useRef, useState } from 'react';
import { SimulationEngine } from '../lib/simulation/SimulationEngine';
import { SimulationConfig } from '../lib/simulation/types';


export function useSimulation(config: SimulationConfig) {
    const engineRef = useRef<SimulationEngine | null>(null);
    const [fps, setFps] = useState(0);
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
        engineRef.current = new SimulationEngine(config);
        setIsInitialized(true);
        
        return () => {
            engineRef.current = null;
            setIsInitialized(false);
        };
    }, []);

    const randomizeRules = () => {
        engineRef.current?.randomizeRules();
    };

    const reset = () => {
        //TODO: UNIMPLEMENTED - probably will never implement cuz it's irrelvant as fuck.
    };

    const togglePause = () => {
        engineRef.current?.togglePause();
    };

    const inject = (thematicScores: Record<string, number>) => {
        engineRef.current?.injectFromScores(thematicScores);
    };

    // Simple update - just calls the engine
    const update = () => {
        const engine = engineRef.current;
        if (!engine || engine.paused) return;
        engine.update();
    };

    return {
        engine: engineRef.current,
        isInitialized,
        fps,
        setFps,
        update, 
        randomizeRules,
        reset,
        togglePause,
        inject
    };
}

