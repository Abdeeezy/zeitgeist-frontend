import { SimulationConfig, AttractionMatrix } from './types';
import {defaultAttractionMatrixConfig} from './simulationConfigs';

import { buildAttractionMatrix, AttractionMatrixConfig} from './attractionMatrix';



export class SimulationEngine {

    // particle-properties partitioned seperately for optimization
    //      seperating particle-data into different structures will boost performance slightly and allow for GPU computing more easily in the future
    positions: Float32Array = new Float32Array();   // initalized as empty          x,y,z, x,y,z,...       for all particles
    velocities: Float32Array = new Float32Array();  // initalized as empty        vx,vy,vz, vx,vy,vz,... for all particles
    types: Uint8Array = new Uint8Array();           // initalized as empty                  type, type,...         for all particles  

    activeParticleCount: number = 0;    // High-water mark — total slots ever used
    spawnQueue: number[] = [];           // FIFO of active slot indices, front = oldest

    grid: Map<string, Set<number>> = new Map(); // spatial hash grid for optimization, initalized as empty. Keys will be "x,y,z", storing particle-INDICES

    attractionMatrix: AttractionMatrix = []; // initalized as empty

    config: SimulationConfig;
    paused: boolean = false; // time-control flag

    // Observer called once at the end of every injectFromScores.
    // ThemeStatBoard subscribes here — no polling needed.
    onInjection: (() => void) | null = null;

    // Log of every injection event. Enables stat tracking and future state replay.
    private articleLog: Array<{ headline: string; themeScores: Record<string, number> }> = [];

    // ordering for particle-injections..
    private themeOrder = [
        'Renewal', 'Aspiration', 'Resilience', 'Compassion', 'Unity',
        'Devotion', 'Abundance', 'Sacrifice', 'Sharing', 'Equilibrium',
        'Moderation', 'Cyclical', 'Transformation', 'Adaptation', 'Flow',
        'Unknown', 'Potentia', 'Ambiguity', 'Entropy', 'Corruption',
        'Erosion', 'Control', 'Subjugation', 'Tyranny', 'Separation',
        'Void', 'Desolation'
    ];


    constructor(config: SimulationConfig) {
        this.config = config;

        // Pre-allocate arrays to max size
        this.positions = new Float32Array(this.config.particleCount * 3);
        this.velocities = new Float32Array(this.config.particleCount * 3);
        this.types = new Uint8Array(this.config.particleCount);

        // instantiate attraction-force-values
        this.initAttractionMatrix();
    }

    //// ATTRACTION MATRIX INITIALIZATION METHODS — two options, one random and one semantically-derived from the theme relationships.
    // defines attraction matrix between particles
    // mathetmatically derived from the semantic relationships between themes, 
    // using the hierarchy and alignment as input, with some manual tweaking/overrides to get the final values more conceptually-accurate. 
    initAttractionMatrix() {
        this.attractionMatrix = buildAttractionMatrix(defaultAttractionMatrixConfig);
    }

    // inject particles corresponding to the processor-api's fetched data
    injectFromScores(thematicScores: Record<string, number>, headline = ''): void {

        //const spawnMulti = this.config.spawnMultiplier; // 
        const spawnDiv = this.config.spawnDivisor;

        this.themeOrder.forEach((themeName, typeIndex) => {
            const score = thematicScores[themeName] || 0;
            //const particleCount = Math.floor(score * spawnMulti);
            let particleCount = score * 10 * this.config.spawnMultiplier; 

            if (particleCount > 1) 
                particleCount = Math.ceil(particleCount / spawnDiv); // apply global spawn divisor, higher = fewer particles spawned overall
           
            for (let j = 0; j < particleCount; j++) {
                this.spawnParticle(typeIndex);
            }
        });

        // Log the injection for stat tracking and future state replay
        this.articleLog.push({ headline, themeScores: thematicScores });

        // Notify subscribers (e.g. ThemeStatBoard) — fires once per injection
        this.onInjection?.();
    }

    // Returns a live count of particles per theme, derived directly from the
    // types array. Reflects overwrite evictions automatically — single source of truth.
    getTypeHistogram(): Record<string, number> {
        const histogram: Record<string, number> = {};

        // Initialise all themes to 0 so the board always has a full dataset
        this.themeOrder.forEach(name => { histogram[name] = 0; });

        for (let i = 0; i < this.activeParticleCount; i++) {
            const themeName = this.themeOrder[this.types[i]];
            if (themeName) histogram[themeName]++;
        }

        return histogram;
    }

    getArticleCount(): number {
        return this.articleLog.length;
    }

    // Spawns a particle, overwriting the oldest slot if the pool is full
    spawnParticle(type: number): boolean {
        let index: number;

        if (this.activeParticleCount < this.config.particleCount) {
            // Pool not yet full — claim the next fresh slot
            index = this.activeParticleCount;
            this.activeParticleCount++;
        } else {
            // Pool full — evict the oldest particle (front of queue)
            index = this.spawnQueue.shift()!;
        }

        // Push this slot to the back of the queue (it is now the newest)
        this.spawnQueue.push(index);

        // Initialize particle at index
        this.types[index] = type;

        // Random position within world
        const x = (Math.random() - 0.5) * this.config.worldSize;
        const y = (Math.random() - 0.5) * this.config.worldSize;
        const z = (Math.random() - 0.5) * this.config.worldSize;

        this.positions[index * 3]     = x;
        this.positions[index * 3 + 1] = y;
        this.positions[index * 3 + 2] = z;

        // Zero velocity
        this.velocities[index * 3]     = 0;
        this.velocities[index * 3 + 1] = 0;
        this.velocities[index * 3 + 2] = 0;

        return true;
    }

    calculateForce(r: number, attraction: number): number {
        const beta = 0.3; // threshold for switching between attraction and repulsion
        if (r < beta) {
            return r / beta - 1;
        } else if (beta < r && r < 1) {
            return attraction * (1 - Math.abs(2 * r - 1 - beta) / (1 - beta));
        }
        return 0;
    }


    // Build the spatial hash grid for the current frame
    updateDecayAndGrid(): void {
        if (this.paused) return;

        // === SPATIAL HASHING ===
        this.grid.clear();
        for (let i = 0; i < this.activeParticleCount; i++) {
            const { x, y, z } = this.quantize(
                this.positions[i * 3],
                this.positions[i * 3 + 1],
                this.positions[i * 3 + 2],
                this.config.cellSize
            );
            const key = `${x},${y},${z}`;

            if (!this.grid.has(key)) {
                this.grid.set(key, new Set());
            }

            this.grid.get(key)?.add(i);
        }
    }

    /**
     * Phase 4: Apply friction and update positions with boundary conditions
     */
    updatePositions(): void {
        if (this.paused) return;

        for (let particleIndex = 0; particleIndex < this.activeParticleCount; particleIndex++) {

            this.updateSphereRepulsion(particleIndex);
        }
    }

    update(): void {
        if (this.paused) return;

        // === DECAY AND SPATIAL-HASHING ===
        this.updateDecayAndGrid();

        // === FORCE CALCULATION ===
        for (let i = 0; i < this.activeParticleCount; i++) {



            // get cell position of this particle
            const { x: cellX, y: cellY, z: cellZ } = this.quantize(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2], this.config.cellSize);
            // get neighouring cells
            const neighbourCells = this.getNeighbourCells(cellX, cellY, cellZ);


            // the net-forces that will be applied onto the particle 
            let totalFx = 0, totalFy = 0, totalFz = 0;
            for (let key of neighbourCells) {
                // if the cell is empty or non-existent, skip
                const cellParticleIndexs = this.grid.get(key);
                if (!cellParticleIndexs) continue;

                for (let particleIndex of cellParticleIndexs) {
                    if (particleIndex === i) continue; // skip self-interaction

                    // calculate distance between particles
                    const dx = this.positions[particleIndex * 3] - this.positions[i * 3];
                    const dy = this.positions[particleIndex * 3 + 1] - this.positions[i * 3 + 1];
                    const dz = this.positions[particleIndex * 3 + 2] - this.positions[i * 3 + 2];
                    const distSquared = dx * dx + dy * dy + dz * dz;
                    //const dist = Math.sqrt(distSquared);

                    //if (dist < this.config.forceRange && dist > 0.01) { // avoid singularity and limit interaction range
                    if (distSquared < this.config.forceRange * this.config.forceRange && distSquared > 0.0001) { // avoid singularity and limit interaction range
                        const typeOfA = this.types[i];
                        const typeOfB = this.types[particleIndex];
                        const attraction = this.attractionMatrix[typeOfA][typeOfB];

                        // only sqrt if within interaction range, since sqrt is expensive
                        const dist = Math.sqrt(distSquared);

                        const normalizedDist = dist / this.config.forceRange;

                        const forceMagnitude = this.calculateForce(normalizedDist, attraction);

                        totalFx += forceMagnitude * (dx / dist);
                        totalFy += forceMagnitude * (dy / dist);
                        totalFz += forceMagnitude * (dz / dist);
                    }


                }
            }
            // update particle velocity based on total force from all other particles
            this.velocities[i * 3] += totalFx * this.config.dt;
            this.velocities[i * 3 + 1] += totalFy * this.config.dt;
            this.velocities[i * 3 + 2] += totalFz * this.config.dt;
        }

        
        // === POSITION UPDATE ===
        this.updatePositions();

    }



    // engine helper functions  
    // get the cell-position on the grid
    quantize(posX: number, posY: number, posZ: number, cellSize: number) {
        return {
            x: Math.floor(posX / cellSize),
            y: Math.floor(posY / cellSize),
            z: Math.floor(posZ / cellSize)
        };
    }

    getNeighbourCells(cellX: number, cellY: number, cellZ: number): string[] {
        const neighbours = [];

        // for each dimension, should be 9 neighbouring cells (including the cell itself), so 27 total for 3D
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    neighbours.push(`${cellX + dx},${cellY + dy},${cellZ + dz}`);
                }
            }
        }

        return neighbours;
    }

    // ====== BOUNARDY-METHOD IMPLEMENTATION #1 ====== 
    // updates position - with world-wrapping boundaries
    updateWrap(particleIndex: number) {
        // apply friction (simulate air/some-medium resistance)
        this.velocities[particleIndex * 3] *= this.config.friction;
        this.velocities[particleIndex * 3 + 1] *= this.config.friction;
        this.velocities[particleIndex * 3 + 2] *= this.config.friction;

        // integrate into position
        this.positions[particleIndex * 3] += this.velocities[particleIndex * 3] * this.config.dt;
        this.positions[particleIndex * 3 + 1] += this.velocities[particleIndex * 3 + 1] * this.config.dt;
        this.positions[particleIndex * 3 + 2] += this.velocities[particleIndex * 3 + 2] * this.config.dt;

        // world-boundaries, wrapping..
        const half = this.config.worldSize / 2;
        if (this.positions[particleIndex * 3] < -half) this.positions[particleIndex * 3] = half;
        if (this.positions[particleIndex * 3] > half) this.positions[particleIndex * 3] = -half;
        if (this.positions[particleIndex * 3 + 1] < -half) this.positions[particleIndex * 3 + 1] = half;
        if (this.positions[particleIndex * 3 + 1] > half) this.positions[particleIndex * 3 + 1] = -half;
        if (this.positions[particleIndex * 3 + 2] < -half) this.positions[particleIndex * 3 + 2] = half;
        if (this.positions[particleIndex * 3 + 2] > half) this.positions[particleIndex * 3 + 2] = -half;
    }

    // ====== BOUNARDY-METHOD IMPLEMENTATION #2 ======  (the one I choose to use, the other one is just to have it there in case I desire the change..)
    // updates position - with sphere repulsion boundaries
    updateSphereRepulsion(particleIndex: number) {
        // apply friction (simulate air/some-medium resistance)
        this.velocities[particleIndex * 3] *= this.config.friction;
        this.velocities[particleIndex * 3 + 1] *= this.config.friction;
        this.velocities[particleIndex * 3 + 2] *= this.config.friction;


        //// establish world boundaries - repulsion from the walls as a sphere
        // world-center
        const cx = 0;
        const cy = 0;
        const cz = 0;
        const radius = this.config.worldSize;
        const boundaryThickness = this.config.boundaryThickness; // thickness of the boundary layer where repulsion occurs
        const boundarySpringStrength = this.config.boundarySpringStrength; // strength of the repulsion force when particle is in the boundary layer

        const k = boundarySpringStrength;        // repulsion/spring strength
        const damping = 2 * Math.sqrt(k);   // critical damping

        // vector from center
        const dx = this.positions[particleIndex * 3] - cx;
        const dy = this.positions[particleIndex * 3 + 1] - cy;
        const dz = this.positions[particleIndex * 3 + 2] - cz;


        const distSquared = dx * dx + dy * dy + dz * dz;
        const threshold = radius - boundaryThickness;
        const thresholdSq = threshold * threshold;

        // Early exit if particle is well within bounds
        if (distSquared <= thresholdSq) {
            // integrate position
            this.positions[particleIndex * 3] += this.velocities[particleIndex * 3] * this.config.dt;
            this.positions[particleIndex * 3 + 1] += this.velocities[particleIndex * 3 + 1] * this.config.dt;
            this.positions[particleIndex * 3 + 2] += this.velocities[particleIndex * 3 + 2] * this.config.dt;
            return;
        }

        const dist = Math.sqrt(distSquared);
        let penetration = dist - threshold;


        // Clamp penetration and force particle back if it exceeded max
        let maxPenetration = 1; // max penetration depth to avoid instability
        if (penetration > maxPenetration) {
            penetration = maxPenetration;
            // Hard clamp position back to max penetration depth
            const targetDist = radius - boundaryThickness + maxPenetration;
            const scale = targetDist / dist;
            this.positions[particleIndex * 3] = cx + dx * scale;
            this.positions[particleIndex * 3 + 1] = cy + dy * scale;
            this.positions[particleIndex * 3 + 2] = cz + dz * scale;

            // Zero out velocity component pointing outward
            const nx = dx / dist;
            const ny = dy / dist;
            const nz = dz / dist;
            const vn = this.velocities[particleIndex * 3] * nx + this.velocities[particleIndex * 3 + 1] * ny + this.velocities[particleIndex * 3 + 2] * nz;
            if (vn > 0) {
                this.velocities[particleIndex * 3] -= vn * nx;
                this.velocities[particleIndex * 3 + 1] -= vn * ny;
                this.velocities[particleIndex * 3 + 2] -= vn * nz;
            }
        }



        // normal (unit vector)
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;

        // velocity along normal
        const vn = this.velocities[particleIndex * 3] * nx + this.velocities[particleIndex * 3 + 1] * ny + this.velocities[particleIndex * 3 + 2] * nz;

        // spring + damping force
        const force = -k * penetration - damping * vn;

        // apply impulse
        this.velocities[particleIndex * 3] += force * nx * this.config.dt;
        this.velocities[particleIndex * 3 + 1] += force * ny * this.config.dt;
        this.velocities[particleIndex * 3 + 2] += force * nz * this.config.dt;


        // integrate position
        this.positions[particleIndex * 3] += this.velocities[particleIndex * 3] * this.config.dt;
        this.positions[particleIndex * 3 + 1] += this.velocities[particleIndex * 3 + 1] * this.config.dt;
        this.positions[particleIndex * 3 + 2] += this.velocities[particleIndex * 3 + 2] * this.config.dt;

    }



    randomizeRules(): void {
        // if desired, user can randomize the attraction matrix to get new emergent behaviors
        //      0-SemanticStrength is essential the old original pure-randomness attraction-matrix.
        this.attractionMatrix = buildAttractionMatrix({semanticStrength:0, ...defaultAttractionMatrixConfig});
    }

    // reset(): void {
    //     // TODO implement reset-button
    //     console.log("IMPLEMENT THIS")
    // }


    togglePause(): void {
        this.paused = !this.paused;
    }
}