import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { SimulationConfig, AttractionMatrix } from './types';

import { defaultAttractionMatrixConfig } from './simulationConfigs';
import { buildAttractionMatrix } from './attractionMatrix';



// --- Texture size -----------------------------------------------------------
// We pack all particles into the smallest square that fits particleCount.
// 2000 particles → 45×45 = 2025 texels (25 inactive slots at the end).
// Changing particleCount at runtime is not supported; recreate the engine.
function calcTextureSize(particleCount: number): number {
    return Math.ceil(Math.sqrt(particleCount));
}

// --- Shaders -----------------------------------------------------------------
// GPUComputationRenderer prepends its own preamble (precision, resolution uniform,
// and the named sampler uniforms).  We only write the body.

function buildVelocityShader(texSize: number, numTypes: number): string {
    return /* glsl */ `
uniform float dt;
uniform float friction;
uniform float forceRange;
uniform float worldSize;
uniform float boundaryStrength;
uniform float boundaryThickness;
uniform float maxSpeed;
uniform sampler2D typeTexture;
uniform int       particleCount;
uniform float     attractionMatrix[${numTypes * numTypes}];

#define TEX_SIZE    ${texSize}
#define NUM_TYPES   ${numTypes}

float getAttraction(int typeA, int typeB) {
    return attractionMatrix[typeA * NUM_TYPES + typeB];
}

// Identical piecewise kernel to CPU calculateForce()
float calculateForce(float r, float attraction) {
    const float beta = 0.3;
    if (r < beta) {
        return r / beta - 1.0;
    } else if (r < 1.0) {
        return attraction * (1.0 - abs(2.0 * r - 1.0 - beta) / (1.0 - beta));
    }
    return 0.0;
}

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    int  ix  = int(gl_FragCoord.x);
    int  iy  = int(gl_FragCoord.y);
    int  myIndex = iy * TEX_SIZE + ix;

    vec4 posData = texture2D(texturePosition, uv);
    vec4 velData = texture2D(textureVelocity, uv);
    vec3 pos = posData.xyz;
    vec3 vel = velData.xyz;

    if (myIndex >= particleCount) {
        gl_FragColor = velData;
        return;
    }

    int myType = int(texture2D(typeTexture, uv).r + 0.5);

    // -- STEP 1: Particle-particle forces -------------------------------------
    // Friction is intentionally NOT applied yet. The CPU applies forces first,
    // then friction inside updatePositions(). We match that order exactly.
    vec3 totalForce = vec3(0.0);
    float forceRangeSq = forceRange * forceRange;

    for (int j = 0; j < TEX_SIZE; j++) {
        for (int i = 0; i < TEX_SIZE; i++) {
            int otherIndex = j * TEX_SIZE + i;
            if (otherIndex >= particleCount) continue;
            if (otherIndex == myIndex)       continue;

            vec2  otherUV  = (vec2(float(i), float(j)) + 0.5) / resolution.xy;
            vec3  otherPos = texture2D(texturePosition, otherUV).xyz;
            vec3  diff     = otherPos - pos;
            float distSq   = dot(diff, diff);

            if (distSq > 0.0001 && distSq < forceRangeSq) {
                float dist       = sqrt(distSq);
                float normDist   = dist / forceRange;
                int   otherType  = int(texture2D(typeTexture, otherUV).r + 0.5);
                float attraction = getAttraction(myType, otherType);
                float forceMag   = calculateForce(normDist, attraction);
                totalForce += forceMag * (diff / dist);
            }
        }
    }

    vel += totalForce * dt;

    // -- STEP 2: Friction - applied AFTER forces, matching CPU order ----------
    vel *= friction;

    // -- STEP 3: Sphere boundary spring + damping ------------------------------
    // pos here is the PRE-integration position (same as CPU reads it).
    float k             = boundaryStrength;
    float damp          = 2.0 * sqrt(k);
    float threshold     = worldSize - boundaryThickness;
    float distFromCenter = length(pos);

    if (distFromCenter > threshold && distFromCenter > 0.001) {
        // Clamp penetration depth to 1.0 to avoid instability at large distances.
        // Position hard-clamping lives in the position shader below.
        float penetration = min(distFromCenter - threshold, 1.0);
        vec3  normal      = pos / distFromCenter;
        float vn          = dot(vel, normal);
        float boundForce  = -k * penetration - damp * vn;

        vel += boundForce * normal * dt;

        // Zero outward velocity when deep in the wall - mirrors the CPU clamp block
        if (distFromCenter > threshold + 1.0 && vn > 0.0) {
            vel -= vn * normal;
        }
    }

    // -- STEP 4: Per-axis velocity cap -----------------------------------------
    // A magnitude cap (normalize * maxSpeed) preserves direction - but if XY
    // forces dominate early on, it freezes that XY bias and slowly drains Z.
    // Per-axis capping treats each component independently, so Z can never be
    // suppressed relative to X and Y by the normalization step.
    vel = sign(vel) * min(abs(vel), vec3(maxSpeed));

    gl_FragColor = vec4(vel, 0.0);
}
`;
}

function buildPositionShader(): string {
    return /* glsl */ `
uniform float dt;
uniform float worldSize;
uniform float boundaryThickness;

void main() {
    vec2 uv  = gl_FragCoord.xy / resolution.xy;
    vec4 posData = texture2D(texturePosition, uv);
    vec3 vel     = texture2D(textureVelocity, uv).xyz;

    vec3 newPos = posData.xyz + vel * dt;

    // Hard position clamp - mirrors CPU's maxPenetration guard.
    // The velocity shader's spring handles most cases, but high-speed particles
    // can tunnel through in a single frame. Clamping the position here ensures
    // the spring force is never overwhelmed by extreme penetration depth.
    float threshold      = worldSize - boundaryThickness;
    float maxPenetration = 1.0;
    float dist           = length(newPos);

    if (dist > threshold + maxPenetration && dist > 0.001) {
        newPos *= (threshold + maxPenetration) / dist;
    }

    gl_FragColor = vec4(newPos, posData.w);
}
`;
}

// --- Shaders for the render mesh (single draw call, GPU→vertex shader) -------
export const GPU_VERTEX_SHADER = /* glsl */ `
uniform sampler2D texturePosition;
uniform sampler2D typeTexture;
uniform float     numTypes;
uniform float     particleSize;
uniform vec3      typeColors[27];   // ← add this

attribute vec2 reference; // per-vertex UV → texel in position texture

varying vec3 vColor;

// // Simple HSL→RGB so we can match the CPU renderer's color scheme
// vec3 hsl2rgb(float h, float s, float l) {
//     float c = (1.0 - abs(2.0 * l - 1.0)) * s;
//     float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
//     float m = l - c * 0.5;
//     vec3 rgb;
//     if      (h < 1.0 / 6.0) rgb = vec3(c, x, 0.0);
//     else if (h < 2.0 / 6.0) rgb = vec3(x, c, 0.0);
//     else if (h < 3.0 / 6.0) rgb = vec3(0.0, c, x);
//     else if (h < 4.0 / 6.0) rgb = vec3(0.0, x, c);
//     else if (h < 5.0 / 6.0) rgb = vec3(x, 0.0, c);
//     else                     rgb = vec3(c, 0.0, x);
//     return rgb + m;
// }

void main() {
    vec4 posData  = texture2D(texturePosition, reference);

    // posData.w == 1.0 for active particles, 0.0 for uninitialised padding slots.
    // syncFromCPU writes w=1 for every synced particle; the position shader
    // propagates it unchanged each frame. Culling here means the geometry can
    // cover all texSize² slots permanently - no rebuild needed after injection.
    if (posData.w < 0.5) {
        gl_Position  = vec4(0.0, 0.0, -2.0, 0.0); // degenerate - clipped by GPU
        gl_PointSize = 0.0;
        vColor       = vec3(0.0);
        return;
    }
    ////before adding typeColors:
    //float typeVal = texture2D(typeTexture, reference).r;
    //float hue     = typeVal / numTypes;
    //vColor = hsl2rgb(hue, 1.0, 0.5);

    ////after adding typeColors:
    int typeIndex = int(texture2D(typeTexture, reference).r + 0.5);
    vColor = typeColors[typeIndex];   
    

    vec4 mvPos = modelViewMatrix * vec4(posData.xyz, 1.0);
    gl_PointSize = particleSize * (300.0 / -mvPos.z);
    gl_Position  = projectionMatrix * mvPos;
}
`;

export const GPU_FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
void main() {
    // Discard corners to produce round points
    vec2 coord = gl_PointCoord - 0.5;
    if (length(coord) > 0.5) discard;
    gl_FragColor = vec4(vColor, 1.0);
}
`;

// --- Engine ------------------------------------------------------------------
export class GPUSimulationEngine {
    config: SimulationConfig;
    paused: boolean = false;

    // Surface kept for interface compatibility with SimulationCanvas / ParticleRenderer.
    // In GPU mode the renderer reads directly from textures, not these arrays.
    activeParticleCount: number;
    spawnQueue: number[] = [];
    positions: Float32Array;  // unused in GPU render path
    velocities: Float32Array; // unused in GPU render path
    types: Uint8Array;

    // GPU internals
    readonly texSize: number;
    private gpuCompute!: GPUComputationRenderer;
    private posVar!: ReturnType<GPUComputationRenderer['addVariable']>;
    private velVar!: ReturnType<GPUComputationRenderer['addVariable']>;
    private _typeTexture!: THREE.DataTexture;
    private initialized = false;
    private threeRenderer!: THREE.WebGLRenderer;

    // Observer called once at the end of every injectFromScores - mirrors CPU engine.
    onInjection: (() => void) | null = null;

    // Log of every injection event. Enables stat tracking and future state replay.
    private articleLog: Array<{ headline: string; themeScores: Record<string, number> }> = [];

    // Kept from the first syncFromCPU call so injectFromScores can bridge back.
    private _cpuEngineRef: {
        positions: Float32Array;
        velocities: Float32Array;
        types: Uint8Array;
        activeParticleCount: number;
        spawnQueue: number[];
        attractionMatrix: number[][];
        injectFromScores: (scores: Record<string, number>) => void;
    } | null = null;

    // Attraction matrix kept in two representations:
    //   - nested array for JS logic / randomisation
    //   - flat Float32Array sent as a shader uniform
    private attractionMatrix: AttractionMatrix = [];
    private attractionFlat: Float32Array;

    private themeOrder = [
        'Renewal', 'Aspiration', 'Resilience', 'Compassion', 'Unity',
        'Devotion', 'Abundance', 'Sacrifice', 'Sharing', 'Equilibrium',
        'Moderation', 'Cyclical', 'Transformation', 'Adaptation', 'Flow',
        'Unknown', 'Potentia', 'Ambiguity', 'Entropy', 'Corruption',
        'Erosion', 'Control', 'Subjugation', 'Tyranny', 'Separation',
        'Void', 'Desolation',
    ];

    constructor(config: SimulationConfig) {
        this.config = config;
        this.texSize = calcTextureSize(config.particleCount);
        this.activeParticleCount = config.particleCount;

        this.types = new Uint8Array(this.texSize * this.texSize);
        this.attractionFlat = new Float32Array(config.numTypes * config.numTypes);

        // Stubs - not used in the GPU render path
        this.positions  = new Float32Array(config.particleCount * 3);
        this.velocities = new Float32Array(config.particleCount * 3);

        this.initAttractionMatrix();
    }

    // -- Initialise GPU resources ---------------------------------------------
    // Must be called once the THREE.WebGLRenderer is available (i.e. in the canvas effect).
    init(renderer: THREE.WebGLRenderer): void {
        // If already initialized, tear down the old GPU resources first.
        // This happens on every GPU toggle because the canvas effect disposes
        // the WebGLRenderer on cleanup, then creates a fresh one - the old
        // gpuCompute is now pointing at a dead context and must be rebuilt.
        if (this.initialized) {
            this.dispose();
        }

        const { texSize, config } = this;

        this.gpuCompute = new GPUComputationRenderer(texSize, texSize, renderer);

        // WebGL1 float-texture extension check
        if (!renderer.capabilities.isWebGL2) {
            if (!renderer.extensions.get('OES_texture_float')) {
                throw new Error('GPU mode requires OES_texture_float or WebGL2.');
            }
        }

        // -- Seed textures --------------------------------------------------
        const dtPosition = this.gpuCompute.createTexture();
        const dtVelocity = this.gpuCompute.createTexture();
        this.seedPositionTexture(dtPosition);
        // velocity texture is all-zero by default from createTexture

        // -- Register compute variables -------------------------------------
         this.velVar = this.gpuCompute.addVariable(
            'textureVelocity',
            buildVelocityShader(texSize, config.numTypes),
            dtVelocity
        );
        this.posVar = this.gpuCompute.addVariable(
            'texturePosition',
            buildPositionShader(),
            dtPosition
        );
       

        // Each variable depends on both (position needs velocity, velocity needs position)
        this.gpuCompute.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
        this.gpuCompute.setVariableDependencies(this.velVar, [this.velVar, this.posVar]);

        // -- Position shader uniforms ---------------------------------------
        const posU = this.posVar.material.uniforms;
        posU.dt                = { value: config.dt };
        posU.worldSize         = { value: config.worldSize };
        posU.boundaryThickness = { value: 2.0 };

        // -- Velocity shader uniforms ---------------------------------------
        const velU = this.velVar.material.uniforms;
        velU.dt                = { value: config.gpuDT};
        velU.friction          = { value: config.friction };
        velU.forceRange        = { value: config.forceRange };
        velU.worldSize         = { value: config.worldSize };
        velU.boundaryStrength  = { value: config.boundarySpringStrength };
        velU.boundaryThickness = { value: config.boundaryThickness };
        velU.maxSpeed          = { value: config.gpuMaxSpeed }; // prevents Inf without clamping normal motion
        velU.particleCount     = { value: this.activeParticleCount };
        velU.attractionMatrix  = { value: this.attractionFlat };
        velU.typeTexture       = { value: null }; // assigned after init

        const error = this.gpuCompute.init();
        if (error !== null) {
            throw new Error(`GPUComputationRenderer init failed: ${error}`);
        }

        // Fix 4: NearestFilter on all ping-pong render targets.
        // Default is LinearFilter, which interpolates between adjacent texels -
        // meaning each particle's sampled position is a blend of its neighbours'.
        // With Nearest, each texel maps to exactly one particle. No blending, no flicker.
        [this.posVar, this.velVar].forEach(variable => {
            variable.renderTargets.forEach((rt: THREE.WebGLRenderTarget) => {
                rt.texture.minFilter = THREE.NearestFilter;
                rt.texture.magFilter = THREE.NearestFilter;
            });
        });

        // Type texture - static unless particles are respawned
        this._typeTexture = this.buildTypeTexture();
        this.velVar.material.uniforms.typeTexture.value = this._typeTexture;

        this.threeRenderer = renderer;
        this.initialized   = true;
    }

    // -- Per-frame compute ----------------------------------------------------
    update(): void {
        if (this.paused || !this.initialized) return;
        this.gpuCompute.compute();
    }

    // -- Texture accessors (used by ParticleRenderer GPU path) ---------------
    get positionTexture(): THREE.Texture {
        return this.gpuCompute.getCurrentRenderTarget(this.posVar).texture;
    }
    get typeTexture(): THREE.Texture {
        return this._typeTexture;
    }

    //// ATTRACTION MATRIX INITIALIZATION METHODS — two options, one random and one semantically-derived from the theme relationships.
    // defines attraction matrix between particles
    // mathetmatically derived from the semantic relationships between themes, 
    // using the hierarchy and alignment as input, with some manual tweaking/overrides to get the final values more conceptually-accurate. 
    initAttractionMatrix(): void {
        this.attractionMatrix = buildAttractionMatrix(defaultAttractionMatrixConfig);

        // must still construct the flattenedMatrix for the shader uniform
        let idx = 0;
        for (let i = 0; i < this.config.numTypes; i++) {
            this.attractionMatrix[i] = [];
            for (let j = 0; j < this.config.numTypes; j++) {
                this.attractionFlat[idx++]  = this.attractionMatrix[i][j];
            }
        }
    }

    // -- State sync from CPU engine --------------------------------------------
    // Call this immediately before switching to GPU mode so particles continue
    // from where the CPU left off rather than re-seeding at random positions.
    syncFromCPU(cpuEngine: { 
        positions: Float32Array; 
        velocities: Float32Array; 
        types: Uint8Array; 
        activeParticleCount: number;
        spawnQueue: number[];
        attractionMatrix: number[][];
        injectFromScores: (scores: Record<string, number>) => void;
    }): void {
        if (!this.initialized) return;

        // Store so injectFromScores can bridge back through the CPU engine
        this._cpuEngineRef = cpuEngine;

        // Mirror the CPU's particle count and FIFO queue so the GPU engine's
        // stats are accurate and eviction order is preserved after re-sync
        this.activeParticleCount = cpuEngine.activeParticleCount;
        this.spawnQueue          = [...cpuEngine.spawnQueue];

        const n = this.texSize * this.texSize;
        const posData  = new Float32Array(n * 4);
        const velData  = new Float32Array(n * 4);
        const typeData = new Float32Array(n * 4);

        for (let i = 0; i < cpuEngine.activeParticleCount; i++) {
            posData[i * 4]     = cpuEngine.positions[i * 3];
            posData[i * 4 + 1] = cpuEngine.positions[i * 3 + 1];
            posData[i * 4 + 2] = cpuEngine.positions[i * 3 + 2];
            posData[i * 4 + 3] = 1.0;

            velData[i * 4]     = cpuEngine.velocities[i * 3];
            velData[i * 4 + 1] = cpuEngine.velocities[i * 3 + 1];
            velData[i * 4 + 2] = cpuEngine.velocities[i * 3 + 2];

            const t = cpuEngine.types[i];
            this.types[i]  = t;
            typeData[i * 4] = t;
        }

        // Copy attraction matrix
        let idx = 0;
        for (let i = 0; i < this.config.numTypes; i++) {
            for (let j = 0; j < this.config.numTypes; j++) {
                this.attractionFlat[idx++] = cpuEngine.attractionMatrix[i]?.[j] ?? 0;
            }
        }
        if (this.initialized) {
            this.velVar.material.uniforms.attractionMatrix.value = this.attractionFlat;
            this.velVar.material.uniforms.particleCount.value    = this.activeParticleCount;
        }

        // Blit position and velocity into both ping-pong render targets
        const posTex = new THREE.DataTexture(posData, this.texSize, this.texSize, THREE.RGBAFormat, THREE.FloatType);
        const velTex = new THREE.DataTexture(velData, this.texSize, this.texSize, THREE.RGBAFormat, THREE.FloatType);
        posTex.needsUpdate = true;
        velTex.needsUpdate = true;

        // GPUComputationRenderer.renderTexture() runs a pass that outputs the
        // source texture unchanged into the target - the correct way to "upload"
        // CPU data into a ping-pong render target.
        this.gpuCompute.renderTexture(posTex, this.posVar.renderTargets[0]);
        this.gpuCompute.renderTexture(posTex, this.posVar.renderTargets[1]);
        this.gpuCompute.renderTexture(velTex, this.velVar.renderTargets[0]);
        this.gpuCompute.renderTexture(velTex, this.velVar.renderTargets[1]);

        // Update type texture in-place
        const td = this._typeTexture.image.data as Float32Array;
        for (let i = 0; i < n * 4; i++) td[i] = typeData[i];
        this._typeTexture.needsUpdate = true;
    }

    // -- Dispose GPU resources -------------------------------------------------
    // Called automatically by init() when re-initializing with a new renderer,
    // and by SimulationCanvas cleanup so the old context is released cleanly.
    dispose(): void {
        if (!this.initialized) return;

        // Dispose both ping-pong render targets for each variable
        this.posVar?.renderTargets?.forEach((rt: THREE.WebGLRenderTarget) => rt.dispose());
        this.velVar?.renderTargets?.forEach((rt: THREE.WebGLRenderTarget) => rt.dispose());

        // Dispose the pass-through material GPUComputationRenderer creates internally
        this.posVar?.material?.dispose();
        this.velVar?.material?.dispose();

        this._typeTexture?.dispose();

        // gpuCompute has no dispose() of its own - the render targets and
        // materials above are all the GPU memory it allocates.
        this._cpuEngineRef = null;
        this.initialized = false;
    }

    randomizeRules(): void {
        // if desired, user can randomize the attraction matrix to get new emergent behaviors
        //      0-SemanticStrength is essential the old original pure-randomness attraction-matrix.
        this.attractionMatrix = buildAttractionMatrix({semanticStrength:0, ...defaultAttractionMatrixConfig});
        
        // flatten the new attraction matrix for the shader uniform
        let idx = 0;
        for (let i = 0; i < this.config.numTypes; i++) {
            for (let j = 0; j < this.config.numTypes; j++) {
                this.attractionFlat[idx++] = this.attractionMatrix[i]?.[j] ?? 0;
            }
        }

        if (this.initialized) {
            // Uniform is a reference to the same Float32Array - just needs a flag set
            this.velVar.material.uniforms.attractionMatrix.value = this.attractionFlat;
        }
    }

    togglePause(): void { this.paused = !this.paused; }

    // -- Spawn / inject -------------------------------------------------------
    spawnParticle(_type: number): boolean { return false; }

    // Bridge pattern:
    //   1. Read GPU's evolved positions/velocities back into the CPU engine's arrays
    //   2. Run injection on CPU - FIFO, position generation, type assignment
    //   3. Re-sync the updated CPU state (including new particles) to GPU
    //
    // The GPU readback is the only expensive step and only occurs on injection
    // events (score updates), never per frame, so the cost is negligible.
    injectFromScores(thematicScores: Record<string, number>, headline = ''): void {
        if (!this.initialized || !this._cpuEngineRef) {
            console.warn('GPUSimulationEngine.injectFromScores: engine not ready');
            return;
        }
        this.readbackToCPU(this._cpuEngineRef);               // Step 1
        this._cpuEngineRef.injectFromScores(thematicScores);  // Step 2
        this.syncFromCPU(this._cpuEngineRef);                 // Step 3

        // Log and notify - must happen after sync so histogram is up to date
        this.articleLog.push({ headline, themeScores: thematicScores });
        this.onInjection?.();
    }

    // Returns a live count of particles per theme from the types array.
    // types is kept in sync with every syncFromCPU, so this always reflects
    // the true simulation state including overwrite evictions.
    getTypeHistogram(): Record<string, number> {
        const histogram: Record<string, number> = {};
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

    // Read the current GPU render-target pixels into the CPU engine's flat arrays
    // so that the next syncFromCPU blits ground-truth positions, not stale ones.
    // Only called from injectFromScores - never per frame.
    private readbackToCPU(cpuEngine: {
        positions: Float32Array;
        velocities: Float32Array;
        types: Uint8Array;
        activeParticleCount: number;
    }): void {
        const { texSize } = this;
        const n = texSize * texSize;
        const posPixels = new Float32Array(n * 4);
        const velPixels = new Float32Array(n * 4);

        const posRT = this.gpuCompute.getCurrentRenderTarget(this.posVar);
        const velRT = this.gpuCompute.getCurrentRenderTarget(this.velVar);
        this.threeRenderer.readRenderTargetPixels(posRT, 0, 0, texSize, texSize, posPixels);
        this.threeRenderer.readRenderTargetPixels(velRT, 0, 0, texSize, texSize, velPixels);

        const count = cpuEngine.activeParticleCount;
        for (let i = 0; i < count; i++) {
            cpuEngine.positions[i * 3]     = posPixels[i * 4];
            cpuEngine.positions[i * 3 + 1] = posPixels[i * 4 + 1];
            cpuEngine.positions[i * 3 + 2] = posPixels[i * 4 + 2];
            cpuEngine.velocities[i * 3]     = velPixels[i * 4];
            cpuEngine.velocities[i * 3 + 1] = velPixels[i * 4 + 1];
            cpuEngine.velocities[i * 3 + 2] = velPixels[i * 4 + 2];
            cpuEngine.types[i] = this.types[i];
        }
        // cpuEngine.spawnQueue is unchanged since toggle - still correct
    }

    // -- Private helpers ------------------------------------------------------
    private seedPositionTexture(tex: THREE.DataTexture): void {
        const data = tex.image.data as Float32Array;
        const half = this.config.worldSize / 2;
        const n    = this.texSize * this.texSize;

        for (let i = 0; i < n; i++) {
            const active = i < this.config.particleCount;
            data[i * 4]     = active ? (Math.random() - 0.5) * half * 2 : 0;
            data[i * 4 + 1] = active ? (Math.random() - 0.5) * half * 2 : 0;
            data[i * 4 + 2] = active ? (Math.random() - 0.5) * half * 2 : 0;
            // w=1 marks an active particle for the vertex shader cull check.
            // Padding slots (i >= particleCount) stay w=0 so they are never rendered.
            data[i * 4 + 3] = active ? 1.0 : 0.0;
        }
    }

    private buildTypeTexture(): THREE.DataTexture {
        const n    = this.texSize * this.texSize;
        const data = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            const type = i < this.config.particleCount
                ? Math.floor(Math.random() * this.config.numTypes)
                : 0;
            this.types[i] = type;
            data[i * 4]   = type; // R = type
            // G, B, A unused for now
        }
        const t = new THREE.DataTexture(
            data, this.texSize, this.texSize,
            THREE.RGBAFormat, THREE.FloatType
        );
        t.needsUpdate = true;
        return t;
    }
}
