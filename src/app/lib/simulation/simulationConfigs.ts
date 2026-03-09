import { COLORSCHEME, SimulationConfig } from './types'
import { AttractionMatrixConfig } from './attractionMatrix';


export const defaultConfig: SimulationConfig = {
  particleCount: 22500,
  numTypes: 27,
  worldSize: 100,
  forceRange: 40,
  cellSize: 40, // should be >= forceRange for correct behavior - this is for CPU-spatial-hashing, spatial-hashing on GPU harder and has not been implemented, but its unneeded so far due to high-fps 
  friction: 0.8,
  dt: 0.25,
  gpuDT: 0.25 / 2, // GPU can be more stable with smaller timesteps; also allows structure to form that's more similar to CPU results 
  gpuMaxSpeed: 20.0, // prevents Inf without clamping normal motion
  particleSize: 0.75,
  spawnMultiplier: 1, 
  spawnDivisor: 2, // global spawn divisor, higher = fewer particles spawned overall 
  boundaryThickness: 15,
  boundarySpringStrength: 1.0, // strength of the repulsion force when particle is in the boundary layer
  colorScheme: COLORSCHEME.HUE_FAMILY_GROUP,
  postProcessingGlowRadius: 2.0,
  postProcessingGlowStrength: 0.7,
};

 export const defaultAttractionMatrixConfig: AttractionMatrixConfig = {
    semanticStrength: 0.3, // if set to 0, identical to the original random matrix, pure beautiful chaos, which i like heh
    weights:{
        moral: 0.4, // attraction based on shared moral alignment (good/neutral/evil)
        hierarchy: 0.5, // attraction based on shared parent in the theme hierarchy
        override: 0.8, // attraction based on specific known relationships that are exceptions to the above (e.g. strong attraction between "Renewal" and "Desolation" due to their conceptual relationship, despite being on opposite sides of the moral spectrum and different branches of the hierarchy)
    },
    driftAmount: 0.015, // how much random drift to apply to the final matrix values, to prevent perfect symmetry and add some unpredictability
}