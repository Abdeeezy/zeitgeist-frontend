
// interfaces for the particle simulation 

export interface SimulationConfig {
    particleCount: number;
    numTypes: number;
    worldSize: number;
    forceRange: number;
    cellSize: number; // spatial-hashing cell size, should be >= forceRange for correct behavior
    friction: number;
    dt: number; 
    gpuDT: number; // GPU can be more stable with smaller timesteps; also allows structure to form that's more similar to CPU results
    gpuMaxSpeed: number;
    particleSize: number;
    spawnMultiplier: number;
    spawnDivisor: number;
    boundaryThickness: number;
    boundarySpringStrength: number; // strength of the repulsion force when particle is in the boundary layer
    colorScheme?: COLORSCHEME;
    postProcessingGlowRadius: number;
    postProcessingGlowStrength: number;
}

export type AttractionMatrix = number[][];

export enum COLORSCHEME {
    HUE_BANDS,
    HUE_FAMILY_GROUP,
    SEMANTIC_PER_THEME,
}