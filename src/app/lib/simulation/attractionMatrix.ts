// -----------------------------------------------------------------------------
// attractionMatrix.ts
// Semantic attraction matrix for a 27-particle simulation.
// Layers: Moral alignment base · Hierarchy proximity · Asymmetric overrides
// Blended with configurable noise so behaviour has semantic tendencies
// without losing the chaos that makes the simulation feel alive.
// -----------------------------------------------------------------------------

// -- 1. Taxonomy ---------------------------------------------------------------

export type ParticleType =
  // Good / Hope
  | "Renewal" | "Aspiration" | "Resilience"
  // Good / Love
  | "Compassion" | "Unity" | "Devotion"
  // Good / Generosity
  | "Abundance" | "Sacrifice" | "Sharing"
  // Neutral / Balance
  | "Equilibrium" | "Moderation" | "Cyclical"
  // Neutral / Change
  | "Transformation" | "Adaptation" | "Flow"
  // Neutral / Mystery
  | "Unknown" | "Potential" | "Ambiguity"
  // Evil / Decay
  | "Entropy" | "Corruption" | "Erosion"
  // Evil / Domination
  | "Control" | "Subjugation" | "Tyranny"
  // Evil / Isolation
  | "Separation" | "Void" | "Desolation";

export const PARTICLE_TYPES: ParticleType[] = [
  "Renewal", "Aspiration", "Resilience",
  "Compassion", "Unity", "Devotion",
  "Abundance", "Sacrifice", "Sharing",
  "Equilibrium", "Moderation", "Cyclical",
  "Transformation", "Adaptation", "Flow",
  "Unknown", "Potential", "Ambiguity",
  "Entropy", "Corruption", "Erosion",
  "Control", "Subjugation", "Tyranny",
  "Separation", "Void", "Desolation",
];

// -- 2. Config -----------------------------------------------------------------

export interface AttractionMatrixConfig {
  /**
   * How strongly the semantic layer influences the final value.
   * 0.0 = pure random, 1.0 = pure semantic.
   * Default: 0.45 - semantic tendencies are present but chaos dominates.
   */
  semanticStrength?: number;

  /**
   * Per-layer weights. Multiplied by semanticStrength before blending.
   */
  weights?: {
    moral?: number;
    hierarchy?: number;
    override?: number;
  };

  /**
   * How much the matrix drifts each call to driftAttractionMatrix().
   * Default: 0.015
   */
  driftAmount?: number;
}

const DEFAULTS = {
  semanticStrength: 0.45,
  weights: {
    moral:     0.4,  // softened - alignment is a nudge, not a law
    hierarchy: 0.5,  // softened - siblings cluster loosely
    override:  0.8,  // kept punchy - narrative moments still land
  },
  driftAmount: 0.015,
} as const;

// -- 3. Hierarchy --------------------------------------------------------------

type Alignment = "good" | "neutral" | "evil";

interface HierarchyEntry {
  alignment: Alignment;
  parent: string;
}

const HIERARCHY: Record<ParticleType, HierarchyEntry> = {
  Renewal:        { alignment: "good",    parent: "Hope"       },
  Aspiration:     { alignment: "good",    parent: "Hope"       },
  Resilience:     { alignment: "good",    parent: "Hope"       },
  Compassion:     { alignment: "good",    parent: "Love"       },
  Unity:          { alignment: "good",    parent: "Love"       },
  Devotion:       { alignment: "good",    parent: "Love"       },
  Abundance:      { alignment: "good",    parent: "Generosity" },
  Sacrifice:      { alignment: "good",    parent: "Generosity" },
  Sharing:        { alignment: "good",    parent: "Generosity" },
  Equilibrium:    { alignment: "neutral", parent: "Balance"    },
  Moderation:     { alignment: "neutral", parent: "Balance"    },
  Cyclical:       { alignment: "neutral", parent: "Balance"    },
  Transformation: { alignment: "neutral", parent: "Change"     },
  Adaptation:     { alignment: "neutral", parent: "Change"     },
  Flow:           { alignment: "neutral", parent: "Change"     },
  Unknown:        { alignment: "neutral", parent: "Mystery"    },
  Potential:      { alignment: "neutral", parent: "Mystery"    },
  Ambiguity:      { alignment: "neutral", parent: "Mystery"    },
  Entropy:        { alignment: "evil",    parent: "Decay"      },
  Corruption:     { alignment: "evil",    parent: "Decay"      },
  Erosion:        { alignment: "evil",    parent: "Decay"      },
  Control:        { alignment: "evil",    parent: "Domination" },
  Subjugation:    { alignment: "evil",    parent: "Domination" },
  Tyranny:        { alignment: "evil",    parent: "Domination" },
  Separation:     { alignment: "evil",    parent: "Isolation"  },
  Void:           { alignment: "evil",    parent: "Isolation"  },
  Desolation:     { alignment: "evil",    parent: "Isolation"  },
};

// -- 4. Alignment polarity -----------------------------------------------------

const ALIGNMENT_POLARITY: Record<Alignment, number> = {
  good:    1,
  neutral: 0,
  evil:   -1,
};

function moralBase(a: ParticleType, b: ParticleType, weight: number): number {
  const pa = ALIGNMENT_POLARITY[HIERARCHY[a].alignment];
  const pb = ALIGNMENT_POLARITY[HIERARCHY[b].alignment];
  const raw = (pa === 0 || pb === 0) ? 0.2 : pa * pb;
  return raw * weight;
}

// -- 5. Hierarchy proximity ----------------------------------------------------

function hierarchyBonus(a: ParticleType, b: ParticleType, weight: number): number {
  if (a === b) return 0.5 * weight;

  const ha = HIERARCHY[a];
  const hb = HIERARCHY[b];

  if (ha.parent === hb.parent)       return 0.3 * weight; // siblings
  if (ha.alignment === hb.alignment) return 0.1 * weight; // cousins
  return 0;
}

// -- 6. Asymmetric narrative overrides -----------------------------------------

type Override = [ParticleType, ParticleType, number];

const OVERRIDES: Override[] = [
  ["Void",           "Potential",       0.8],
  ["Potential",      "Void",           -0.6],
  ["Corruption",     "Abundance",       0.7],
  ["Abundance",      "Corruption",     -0.8],
  ["Sacrifice",      "Unity",           0.9],
  ["Unity",          "Sacrifice",       0.5],
  ["Entropy",        "Equilibrium",     0.6],
  ["Equilibrium",    "Entropy",        -0.4],
  ["Renewal",        "Erosion",        -0.7],
  ["Erosion",        "Renewal",         0.3],
  ["Tyranny",        "Devotion",        0.5],
  ["Devotion",       "Tyranny",        -0.9],
  ["Transformation", "Ambiguity",       0.6],
  ["Ambiguity",      "Transformation",  0.4],
  ["Desolation",     "Sharing",         0.5],
  ["Sharing",        "Desolation",     -0.6],
  ["Compassion",     "Separation",      0.6],
  ["Separation",     "Compassion",     -0.2],
  ["Control",        "Flow",            0.5],
  ["Flow",           "Control",        -0.5],
];

type OverrideKey = `${string}→${string}`;

const OVERRIDE_MAP = new Map<OverrideKey, number>(
  OVERRIDES.map(([from, to, val]) => [`${from}→${to}`, val])
);

function getOverride(a: ParticleType, b: ParticleType, weight: number): number {
  return (OVERRIDE_MAP.get(`${a}→${b}`) ?? 0) * weight;
}

// -- 7. Core helpers -----------------------------------------------------------

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function rand(): number {
  return Math.random() * 2 - 1;
}

interface LayerWeights {
  moral: number;
  hierarchy: number;
  override: number;
}

export function semanticAttraction(
  a: ParticleType,
  b: ParticleType,
  weights: LayerWeights = DEFAULTS.weights
): number {
  return clamp(
    moralBase(a, b, weights.moral) +
    hierarchyBonus(a, b, weights.hierarchy) +
    getOverride(a, b, weights.override)
  );
}

// -- 8. Matrix builders --------------------------------------------------------

/**
 * Builds the full 27×27 attraction matrix.
 *
 * Each value is:
 *   semantic * semanticStrength + random * (1 - semanticStrength)
 *
 * At the default semanticStrength of 0.45 the simulation stays chaotic,
 * but semantic tendencies are statistically present over time - particles
 * drift toward narrative-correct behaviour without snapping to it.
 *
 * Drop-in replacement for your existing attractionMatrix[i][j] usage.
 */
export function buildAttractionMatrix(config: AttractionMatrixConfig = {}): number[][] {
  const strength = config.semanticStrength ?? DEFAULTS.semanticStrength;
  const weights: LayerWeights = { ...DEFAULTS.weights, ...config.weights };
  const n        = PARTICLE_TYPES.length;

  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      const semantic = semanticAttraction(PARTICLE_TYPES[i], PARTICLE_TYPES[j], weights);
      return clamp(semantic * strength + rand() * (1 - strength));
    })
  );
}

/**
 * Slowly mutates an existing matrix by adding tiny random deltas each call.
 * Call every N frames to keep the simulation from ever fully settling.
 *
 * @example
 * // Every 120 frames:
 * if (frame % 120 === 0) {
 *   this.attractionMatrix = driftAttractionMatrix(this.attractionMatrix);
 * }
 */
export function driftAttractionMatrix(
  matrix: number[][],
  config: AttractionMatrixConfig = {}
): number[][] {
  const amount = config.driftAmount ?? DEFAULTS.driftAmount;
  return matrix.map(row =>
    row.map(v => clamp(v + rand() * amount))
  );
}

// -- 9. Debug ------------------------------------------------------------------

export function explainAttraction(
  a: ParticleType,
  b: ParticleType,
  config: AttractionMatrixConfig = {}
): string {
  const weights: LayerWeights = { ...DEFAULTS.weights, ...config.weights };
  const strength = config.semanticStrength ?? DEFAULTS.semanticStrength;

  const moral     = moralBase(a, b, weights.moral);
  const hierarchy = hierarchyBonus(a, b, weights.hierarchy);
  const override  = getOverride(a, b, weights.override);
  const semantic  = clamp(moral + hierarchy + override);

  return [
    `${a} → ${b}`,
    `  moral base:     ${moral.toFixed(2)}`,
    `  hierarchy:     +${hierarchy.toFixed(2)}`,
    `  override:      +${override.toFixed(2)}`,
    `  -------------------------------------`,
    `  semantic total: ${semantic.toFixed(2)}`,
    `  after blend:    ${(semantic * strength).toFixed(2)} semantic + up to ${(1 - strength).toFixed(2)} random`,
  ].join("\n");
}
