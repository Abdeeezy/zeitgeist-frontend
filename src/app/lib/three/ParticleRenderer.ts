import * as THREE from 'three';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { GPUSimulationEngine, GPU_VERTEX_SHADER, GPU_FRAGMENT_SHADER } from '../simulation/GPUSimulationEngine';
import { COLORSCHEME } from '../simulation/types';
import { getTypeColors } from '../simulation/typeColors';

// post-processing-related 
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SavePass } from 'three/addons/postprocessing/SavePass.js';
import { CopyShader } from 'three/addons/shaders/CopyShader.js';

// Union type so callers can pass either engine
export type AnyEngine = SimulationEngine | GPUSimulationEngine;





// -- post-processing-related Glow shaders -------------------------------------------------------------

const HBlurShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2() },
        radius: { value: 1.5 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float radius;
        varying vec2 vUv;

        void main() {
            vec2 texel = vec2(radius / resolution.x, 0.0);
            vec4 sum = vec4(0.0);
            sum += texture2D(tDiffuse, vUv - texel * 4.0) * 0.0625;
            sum += texture2D(tDiffuse, vUv - texel * 3.0) * 0.125;
            sum += texture2D(tDiffuse, vUv - texel * 2.0) * 0.1875;
            sum += texture2D(tDiffuse, vUv - texel * 1.0) * 0.25;
            sum += texture2D(tDiffuse, vUv)               * 0.25;
            sum += texture2D(tDiffuse, vUv + texel * 1.0) * 0.25;
            sum += texture2D(tDiffuse, vUv + texel * 2.0) * 0.1875;
            sum += texture2D(tDiffuse, vUv + texel * 3.0) * 0.125;
            sum += texture2D(tDiffuse, vUv + texel * 4.0) * 0.0625;
            gl_FragColor = sum;
        }
    `,
};

const VBlurShader = {
    uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2() },
        radius: { value: 1.5 },
    },
    vertexShader: HBlurShader.vertexShader, // identical
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float radius;
        varying vec2 vUv;

        void main() {
            vec2 texel = vec2(0.0, radius / resolution.y);
            vec4 sum = vec4(0.0);
            sum += texture2D(tDiffuse, vUv - texel * 4.0) * 0.0625;
            sum += texture2D(tDiffuse, vUv - texel * 3.0) * 0.125;
            sum += texture2D(tDiffuse, vUv - texel * 2.0) * 0.1875;
            sum += texture2D(tDiffuse, vUv - texel * 1.0) * 0.25;
            sum += texture2D(tDiffuse, vUv)               * 0.25;
            sum += texture2D(tDiffuse, vUv + texel * 1.0) * 0.25;
            sum += texture2D(tDiffuse, vUv + texel * 2.0) * 0.1875;
            sum += texture2D(tDiffuse, vUv + texel * 3.0) * 0.125;
            sum += texture2D(tDiffuse, vUv + texel * 4.0) * 0.0625;
            gl_FragColor = sum;
        }
    `,
};

const AdditiveBlendShader = {
    uniforms: {
        tDiffuse: { value: null }, // the blurred texture (from composer chain)
        tSharp: { value: null }, // the saved sharp render
        strength: { value: 0.4 }, // ← tweak this for more/less glow
    },
    vertexShader: HBlurShader.vertexShader,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tSharp;
        uniform float strength;
        varying vec2 vUv;

        void main() {
            vec4 sharp  = texture2D(tSharp, vUv);
            vec4 blurry = texture2D(tDiffuse, vUv);
            gl_FragColor = sharp + blurry * strength;
        }
    `,
};
// -----------------------------------------------------------------------------



export class ParticleRenderer {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;

    // Post-processing related objects for the glow effect
    private composer: EffectComposer | null = null;
    private sharpTarget: THREE.WebGLRenderTarget | null = null;

    //  CPU render path (one Points mesh per type, 27 draw calls) 
    private cpuGeometries: THREE.BufferGeometry[] = [];
    private cpuMaterials: THREE.PointsMaterial[] = [];
    private cpuMeshes: THREE.Points[] = [];
    private typeColors: THREE.Color[] = [];

    // -- GPU render path (single Points mesh, type→colour in vertex shader) --
    private gpuMesh: THREE.Points | null = null;
    private gpuMaterial: THREE.ShaderMaterial | null = null;
    private gpuGeometry: THREE.BufferGeometry | null = null;

    private mode: 'cpu' | 'gpu' = 'cpu';

    constructor(canvas: HTMLCanvasElement, numTypes: number, existingRenderer?: THREE.WebGLRenderer) {
        this.scene = new THREE.Scene();

        this.camera = new THREE.PerspectiveCamera(
            75,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            1000
        );
        this.camera.position.z = 150;

        // Accept an externally-created renderer so the GPU engine can share it.
        // If none is provided, create one (CPU-only backward compatibility).
        if (existingRenderer) {
            this.renderer = existingRenderer;
        } else {
            this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        }

        this.initTypeColors(numTypes);
    }

    // -- Color initialisation -------------------------------------------------
    initTypeColors(scheme: COLORSCHEME): void {

        // get the colors depending on the chosen scheme, then convert to THREE.Color objects
        this.typeColors = getTypeColors(scheme).map(css => new THREE.Color(css));

        // If GPU mesh is already live, push the new palette to the shader
        if (this.gpuMaterial) {
            this.gpuMaterial.uniforms.typeColors.value =
                this.typeColors.map(c => new THREE.Vector3(c.r, c.g, c.b));
        }
    }


    // Post-processing initalization for the glow effect. Called once from the parent after the renderer is created.
    initGlow(width: number, height: number, radius = 1.5, strength = 0.4): void {
        this.sharpTarget = new THREE.WebGLRenderTarget(width, height);

        this.composer = new EffectComposer(this.renderer);

        // 1. Render scene
        this.composer.addPass(new RenderPass(this.scene, this.camera));

        // 2. Save the sharp frame before we blur it
        const savePass = new SavePass(this.sharpTarget);
        this.composer.addPass(savePass);

        // 3. Horizontal blur
        const hBlur = new ShaderPass(HBlurShader);
        hBlur.uniforms.resolution.value.set(width, height);
        hBlur.uniforms.radius.value = radius;
        this.composer.addPass(hBlur);

        // 4. Vertical blur
        const vBlur = new ShaderPass(VBlurShader);
        vBlur.uniforms.resolution.value.set(width, height);
        vBlur.uniforms.radius.value = radius;
        this.composer.addPass(vBlur);

        // 5. Additive blend: sharp + blurred
        const additive = new ShaderPass(AdditiveBlendShader);
        additive.uniforms.tSharp.value = this.sharpTarget.texture;
        additive.uniforms.strength.value = strength;
        this.composer.addPass(additive);
    }


    // -- CPU mesh setup -------------------------------------------------------
    createParticleMeshes(numTypes: number, particleSize: number): void {
        this.clearCPUMeshes();
        this.mode = 'cpu';

        for (let i = 0; i < numTypes; i++) {
            const geo = new THREE.BufferGeometry();
            const mat = new THREE.PointsMaterial({
                color: this.typeColors[i],
                size: particleSize,
                sizeAttenuation: true,
            });
            const mesh = new THREE.Points(geo, mat);
            this.scene.add(mesh);
            this.cpuGeometries.push(geo);
            this.cpuMaterials.push(mat);
            this.cpuMeshes.push(mesh);
        }
    }

    // -- GPU mesh setup -------------------------------------------------------
    // Called once after GPUSimulationEngine.init().
    createGPUMesh(engine: GPUSimulationEngine): void {
        this.clearGPUMesh();
        this.clearCPUMeshes();
        this.mode = 'gpu';

        const { texSize, config } = engine;

        // Geometry covers ALL texSize² slots, not just activeParticleCount.
        // This means the mesh never needs rebuilding when new particles inject
        // into previously-empty slots. The vertex shader culls inactive slots
        // via the w channel of the position texture (w=0 → degenerate clip position).
        const totalSlots = texSize * texSize;
        const geo = new THREE.BufferGeometry();
        const refs = new Float32Array(totalSlots * 2);

        for (let i = 0; i < totalSlots; i++) {
            const ix = i % texSize;
            const iy = Math.floor(i / texSize);
            // UV must land in the *centre* of each texel
            refs[i * 2] = (ix + 0.5) / texSize;
            refs[i * 2 + 1] = (iy + 0.5) / texSize;
        }

        geo.setAttribute('reference', new THREE.BufferAttribute(refs, 2));
        // Dummy position attribute required by WebGL - actual positions come from the texture.
        // We set it to zeros; the vertex shader overrides gl_Position entirely.
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(totalSlots * 3), 3));

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                texturePosition: { value: engine.positionTexture },
                typeTexture: { value: engine.typeTexture },
                numTypes: { value: config.numTypes },
                particleSize: { value: config.particleSize },
                typeColors: { value: this.typeColors.map(c => new THREE.Vector3(c.r, c.g, c.b)) },
            },
            vertexShader: GPU_VERTEX_SHADER,
            fragmentShader: GPU_FRAGMENT_SHADER,
        });

        const mesh = new THREE.Points(geo, mat);
        this.scene.add(mesh);

        this.gpuGeometry = geo;
        this.gpuMaterial = mat;
        this.gpuMesh = mesh;
    }

    // -- Per-frame update -----------------------------------------------------
    updateParticles(engine: AnyEngine): void {
        if (this.mode === 'gpu') {
            this.updateGPU(engine as GPUSimulationEngine);
        } else {
            this.updateCPU(engine as SimulationEngine);
        }
    }

    private updateGPU(engine: GPUSimulationEngine): void {
        if (!this.gpuMaterial) return;
        // The GPU engine's positionTexture is a render-target texture that ping-pongs
        // every frame.  We must re-bind it each frame so the material samples the latest one.
        this.gpuMaterial.uniforms.texturePosition.value = engine.positionTexture;
    }

    private updateCPU(engine: SimulationEngine): void {
        // Re-use the original CPU path verbatim to keep that path untouched.
        const byType: number[][] = Array.from({ length: engine.config.numTypes }, () => []);
        for (let i = 0; i < engine.activeParticleCount; i++) {
            byType[engine.types[i]].push(
                engine.positions[i * 3],
                engine.positions[i * 3 + 1],
                engine.positions[i * 3 + 2],
            );
        }
        for (let i = 0; i < engine.config.numTypes; i++) {
            const positions = new Float32Array(byType[i]);
            this.cpuGeometries[i].setAttribute(
                'position',
                new THREE.BufferAttribute(positions, 3)
            );
        }
    }

    // -- Render ---------------------------------------------------------------
    render(): void {
        // if the composer is set up (if the initGlow method has been called after construction of the ParticleRenderer object)
        this.composer
            ? this.composer.render() // render with this (contains the renderer but with a post-processing layer for the glow effect)
            : this.renderer.render(this.scene, this.camera); //else, there is no post-processing set up, just use base-renderer
    }

    resize(width: number, height: number): void {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);

        this.composer?.setSize(width, height);
        this.sharpTarget?.setSize(width, height);
        // Also update resolution uniforms on the blur passes
        // (easiest to just call initGlow again if you resize)
    }

    // -- Cleanup ---------------------------------------------------------------
    dispose(): void {
        this.clearCPUMeshes();
        this.clearGPUMesh();
        this.renderer.dispose();
        
        this.composer?.passes.forEach(p => p.dispose?.());
        this.sharpTarget?.dispose();
    }

    private clearCPUMeshes(): void {
        this.cpuMeshes.forEach(m => this.scene.remove(m));
        this.cpuGeometries.forEach(g => g.dispose());
        this.cpuMaterials.forEach(m => m.dispose());
        this.cpuMeshes = [];
        this.cpuGeometries = [];
        this.cpuMaterials = [];
    }

    private clearGPUMesh(): void {
        if (this.gpuMesh) this.scene.remove(this.gpuMesh);
        this.gpuGeometry?.dispose();
        this.gpuMaterial?.dispose();
        this.gpuMesh = null;
        this.gpuGeometry = null;
        this.gpuMaterial = null;
    }
}
