import type { Per100 } from '../services/foodParser';

/// How a food was cooked. The DB per-100g row is treated as the neutral baseline
/// (`raw`); the other methods apply a COARSE multiplier on top. Because real
/// outcomes vary with oil, time and cut, any non-neutral method marks the item
/// `approximate` — we never present a fried-adjustment as exact DB fact.
export type CookMethod = 'raw' | 'boiled' | 'fried' | 'baked' | 'grilled' | 'stewed';

/// Display/selection order for the chip row.
export const COOK_METHODS: readonly CookMethod[] = [
  'raw',
  'boiled',
  'fried',
  'baked',
  'grilled',
  'stewed',
];

interface CookFactor {
  kcal: number;
  fat: number;
  prot: number;
  carb: number;
}

/// Coarse, defensible macro/kcal multipliers vs the DB baseline. These are
/// intentionally rough bands, not precise yields — protein and carbs are left at
/// ×1 (cooking adds neither; water-loss concentration is too variable to claim).
/// Sources are general USDA cooking-yield / fat-absorption observations.
const FACTORS: Record<CookMethod, CookFactor> = {
  // Baseline: the DB row as-is. No energy added.
  raw: { kcal: 1.0, fat: 1.0, prot: 1.0, carb: 1.0 },
  // Water cooking adds no energy; leaching is minor → treat as baseline.
  boiled: { kcal: 1.0, fat: 1.0, prot: 1.0, carb: 1.0 },
  // Pan/deep frying absorbs oil — the dominant kcal/fat driver (~+40% kcal,
  // fat can roughly double for pan-fried items). Coarse upper-ish band.
  fried: { kcal: 1.4, fat: 1.8, prot: 1.0, carb: 1.0 },
  // Baking/roasting: a little added fat + water-loss concentration.
  baked: { kcal: 1.1, fat: 1.15, prot: 1.0, carb: 1.0 },
  // Grilling: little added fat and some renders/drips off → near-neutral energy.
  grilled: { kcal: 1.05, fat: 1.0, prot: 1.0, carb: 1.0 },
  // Stewing: modest oil/fat carried in the sauce.
  stewed: { kcal: 1.1, fat: 1.3, prot: 1.0, carb: 1.0 },
};

/// True when the method leaves the baseline numbers unchanged (raw / boiled).
/// Used to decide whether the adjustment should raise the `approximate` flag.
export function isNeutralCookMethod(method: CookMethod): boolean {
  const f = FACTORS[method];
  return f.kcal === 1 && f.fat === 1 && f.prot === 1 && f.carb === 1;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/// Apply a cooking method's coarse factors to a DB baseline per-100g block.
/// Pure + deterministic; minerals and `source` pass through unchanged (per-method
/// mineral changes are out of scope for v1). `raw` is the identity.
export function applyCookFactor(base: Per100, method: CookMethod): Per100 {
  const f = FACTORS[method];
  return {
    ...base,
    kcal: Math.round(base.kcal * f.kcal),
    prot: round1(base.prot * f.prot),
    fat: round1(base.fat * f.fat),
    carb: round1(base.carb * f.carb),
  };
}
