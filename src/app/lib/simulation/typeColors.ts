import { COLORSCHEME } from './types';

// ─── Theme order (index 0–26) ─────────────────────────────────────────────────
// Must stay in sync with the themeOrder arrays in SimulationEngine and
// GPUSimulationEngine.  This is the single authoritative list for palette work.
export const THEME_ORDER = [
    'Renewal', 'Aspiration', 'Resilience', 'Compassion', 'Unity',
    'Devotion', 'Abundance', 'Sacrifice', 'Sharing', 'Equilibrium',
    'Moderation', 'Cyclical', 'Transformation', 'Adaptation', 'Flow',
    'Unknown', 'Potentia', 'Ambiguity', 'Entropy', 'Corruption',
    'Erosion', 'Control', 'Subjugation', 'Tyranny', 'Separation',
    'Void', 'Desolation',
] as const;

// ─── Palette function ─────────────────────────────────────────────────────────
// Returns 27 CSS colour strings in THEME_ORDER index order.
// ParticleRenderer and ThemeStatBoard both call this — single source of truth.

// Leaf order (index 0–26):
    // Good:    Renewal, Aspiration, Resilience, Compassion, Unity, Devotion, Abundance, Sacrifice, Sharing
    // Neutral: Equilibrium, Moderation, Cyclical, Transformation, Adaptation, Flow, Unknown, Potential, Ambiguity
    // Evil:    Entropy, Corruption, Erosion, Control, Subjugation, Tyranny, Separation, Void, Desolation

    
export function getTypeColors(scheme: COLORSCHEME = COLORSCHEME.SEMANTIC_PER_THEME): string[] {
    switch (scheme) {

        // ── A: Hue Bands ──────────────────────────────────────────────────────
        // Good  → yellows/greens/cyans  (HSL 60–160°)
        // Neutral → cyans/blues/purples (HSL 160–260°), mid brightness, lower sat
        // Evil  → purples/reds/oranges  (HSL 260–360/0–40°), dark
        case COLORSCHEME.HUE_BANDS: {
            const hsl: [number, number, number][] = [
                // Good (9)
                [0.222, 1.00, 0.55],  // Renewal       — yellow-green
                [0.278, 0.90, 0.55],  // Aspiration    — green
                [0.167, 1.00, 0.55],  // Resilience    — yellow
                [0.333, 0.90, 0.55],  // Compassion    — medium green
                [0.361, 1.00, 0.58],  // Unity         — cyan-green
                [0.194, 1.00, 0.52],  // Devotion      — yellow-lime
                [0.389, 0.95, 0.58],  // Abundance     — cyan
                [0.250, 0.90, 0.52],  // Sacrifice     — green
                [0.417, 0.95, 0.58],  // Sharing       — teal
                // Neutral (9) — lower saturation, mid lightness
                [0.444, 0.45, 0.50],  // Equilibrium   — slate teal
                [0.500, 0.40, 0.55],  // Moderation    — slate blue
                [0.458, 0.60, 0.52],  // Cyclical      — teal-blue
                [0.556, 0.70, 0.52],  // Transformation — blue
                [0.528, 0.50, 0.48],  // Adaptation    — muted blue
                [0.542, 0.65, 0.52],  // Flow          — mid blue
                [0.611, 0.55, 0.42],  // Unknown       — indigo
                [0.639, 0.50, 0.48],  // Potentia      — violet-blue
                [0.583, 0.35, 0.48],  // Ambiguity     — muted purple
                // Evil (9) — dark, low lightness
                [0.056, 0.80, 0.32],  // Entropy       — burnt orange
                [0.111, 0.70, 0.30],  // Corruption    — dark gold
                [0.028, 0.85, 0.30],  // Erosion       — deep red-orange
                [0.944, 0.65, 0.30],  // Control       — crimson
                [0.917, 0.70, 0.28],  // Subjugation   — dark rose-red
                [0.000, 0.90, 0.32],  // Tyranny       — blood red
                [0.778, 0.60, 0.28],  // Separation    — deep purple
                [0.750, 0.90, 0.14],  // Void          — near-black violet
                [0.833, 0.55, 0.24],  // Desolation    — dark purple-red
            ];
            return hsl.map(([h, s, l]) =>
                `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`
            );
        }

        // ── B: Hue Family Per Group ───────────────────────────────────────────
        // Each of the 9 groups owns a hue; 3 themes = light / mid / dark variants
        case COLORSCHEME.HUE_FAMILY_GROUP:
            return [
                // Hope — gold/amber
                '#ffdd44', '#ffbb22', '#cc8800',
                // Love — rose/pink
                '#ff9999', '#ff6688', '#cc3355',
                // Generosity — jade green
                '#88ffcc', '#44cc88', '#229966',
                // Balance — slate blue-grey
                '#aabbcc', '#8899aa', '#667788',
                // Change — electric teal
                '#00ffee', '#00bbaa', '#008877',
                // Mystery — lavender
                '#ccbbff', '#aa88ee', '#7755bb',
                // Decay — bile yellow-green
                '#cccc44', '#999900', '#666600',
                // Domination — blood red
                '#ff4444', '#cc2222', '#880000',
                // Isolation — cold indigo
                '#8888ff', '#4444cc', '#220066',
            ];

        // ── C: Semantic Per-Theme ─────────────────────────────────────────────
        // Each theme gets the color most conceptually true to it.
        // Good: bright & saturated. Neutral: mid & desaturated. Evil: dark/sickly.
        case COLORSCHEME.SEMANTIC_PER_THEME:
        default:
            return [
                // Good
                '#4af78c',  // Renewal      — fresh spring green
                '#4ab8f7',  // Aspiration   — clear horizon blue
                '#f7c84a',  // Resilience   — warm beaten gold
                '#f77aaa',  // Compassion   — soft rose
                '#f5f0e0',  // Unity        — warm ivory
                '#f7a030',  // Devotion     — candlelight amber
                '#f7c24a',  // Abundance    — harvest gold
                '#cc2244',  // Sacrifice    — deep crimson
                '#f78860',  // Sharing      — warm coral
                // Neutral
                '#8aaabb',  // Equilibrium  — pale blue-grey
                '#c0c4cc',  // Moderation   — clean silver
                '#4ab8aa',  // Cyclical     — turquoise
                '#00e8cc',  // Transformation — electric cyan
                '#88aa77',  // Adaptation   — muted sage-olive
                '#66ccdd',  // Flow         — light aqua
                '#334488',  // Unknown      — deep space blue
                '#9977cc',  // Potentia     — latent lavender
                '#7a7a99',  // Ambiguity    — foggy grey-purple
                // Evil
                '#aa5522',  // Entropy      — dark rust
                '#88cc00',  // Corruption   — toxic yellow-green
                '#885533',  // Erosion      — dusty red-brown
                '#4466aa',  // Control      — cold steel blue
                '#663388',  // Subjugation  — bruised purple
                '#cc1122',  // Tyranny      — blood red
                '#aaccdd',  // Separation   — icy pale blue
                '#1a0033',  // Void         — near-black deep violet
                '#555560',  // Desolation   — ashen grey
            ];
    }
}
