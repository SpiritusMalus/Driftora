/**
 * Wire contracts for the food-parse service (BUILD SPEC §4).
 *
 * THE HONESTY RULE (§1): per-100g composition is EXACT (from the nutrition DB);
 * the whole-dish total is APPROXIMATE while the weight is only estimated. The
 * LLM never emits nutrition numbers — it only identifies foods + estimates grams.
 * Every number in a `MealDraft` comes from a `NutritionProvider`, never the model.
 *
 * These shapes MUST stay byte-for-byte compatible with the app's
 * `lib/core/services/foodParser.ts`.
 */

export type Region = 'RU' | 'US';

export type ParseConfidence = 'high' | 'medium' | 'low';

/** Where a per-100g number came from. `estimate` = DB miss (coarse, not fact). */
export type NutritionSource =
  | 'usda'
  | 'skurikhin'
  | 'openfoodfacts'
  | 'apininjas'
  | 'fatsecret'
  | 'estimate';

/** Mineral set v1 (BUILD SPEC §10). mg per 100 g. Extend as data allows. */
export interface Minerals {
  na?: number;
  k?: number;
  ca?: number;
  mg?: number;
  fe?: number;
  zn?: number;
}

/** Macros + minerals for a fixed quantity (per-100g or scaled). */
export interface NutrientValues {
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
  minerals: Minerals;
}

/** EXACT per-100g composition from the nutrition DB (or a coarse `estimate`). */
export interface Per100 extends NutrientValues {
  source: NutritionSource;
}

/** Layer 1/2 output — identification only, NO nutrition numbers (§4). */
export interface IdentifiedItem {
  name_ru: string;
  name_en: string;
  est_grams: number;
  confidence: number; // 0..1
  raw_text?: string;
}

export interface Identified {
  source: 'vision' | 'text';
  model: string;
  region: Region;
  items: IdentifiedItem[];
}

/** Layer 3 output, per component — exact per-100g + scaled-to-grams total. */
/** A runner-up DB match the user can switch to when the primary is wrong. */
export interface NutritionAlternative {
  name: string; // display name from the source
  per100: Per100; // EXACT composition (carries its own source label)
}

export interface NutritionItem {
  name_ru: string;
  name_en: string;
  grams: number;
  grams_source: 'estimated' | 'confirmed';
  confidence: number; // 0..1, carried from identification
  per100: Per100; // EXACT (or estimate on a DB miss)
  scaled: NutrientValues; // per100 * grams / 100
  approximate: boolean; // true while grams_source === 'estimated'
  // Other ranked DB matches for the same item (best-first), present when the
  // source returned >1 candidate. The client offers them behind "не то?" and
  // shows the picker proactively when confidence is low.
  alternatives?: NutritionAlternative[];
}

export interface MealDraft {
  region: Region;
  items: NutritionItem[];
  totals: NutrientValues;
  portion_state: 'estimated' | 'confirmed';
  approximate: boolean; // true if any item is still estimated
  flags: {
    has_estimate: boolean; // at least one per100.source === 'estimate' (DB miss)
    low_confidence: boolean; // at least one item below the confidence floor
  };
}

const MINERAL_KEYS: readonly (keyof Minerals)[] = ['na', 'k', 'ca', 'mg', 'fe', 'zn'];
const LOW_CONFIDENCE_FLOOR = 0.5;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Scale a per-100g block to `grams`, rounding minerals to whole mg. */
export function scaleToGrams(per100: NutrientValues, grams: number): NutrientValues {
  const factor = Math.max(0, grams) / 100;
  const minerals: Minerals = {};
  for (const key of MINERAL_KEYS) {
    const v = per100.minerals[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      minerals[key] = Math.round(v * factor);
    }
  }
  return {
    kcal: Math.round(per100.kcal * factor),
    prot: round1(per100.prot * factor),
    fat: round1(per100.fat * factor),
    carb: round1(per100.carb * factor),
    minerals,
  };
}

/** Sum scaled component values into a single totals block. */
export function sumNutrients(items: { scaled: NutrientValues }[]): NutrientValues {
  const minerals: Minerals = {};
  let kcal = 0;
  let prot = 0;
  let fat = 0;
  let carb = 0;
  for (const it of items) {
    kcal += it.scaled.kcal;
    prot += it.scaled.prot;
    fat += it.scaled.fat;
    carb += it.scaled.carb;
    for (const key of MINERAL_KEYS) {
      const v = it.scaled.minerals[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        minerals[key] = (minerals[key] ?? 0) + v;
      }
    }
  }
  return { kcal: Math.round(kcal), prot: round1(prot), fat: round1(fat), carb: round1(carb), minerals };
}

/** Build the meal-level totals/flags from already-resolved items. */
export function assembleMealDraft(region: Region, items: NutritionItem[]): MealDraft {
  const approximate = items.some((it) => it.approximate);
  return {
    region,
    items,
    // A full DB miss (`source: 'estimate'`) is a fabricated placeholder the
    // client never shows numbers for, so it must not leak into the dish total
    // either — it counts only once the user supplies real macros (THE HONESTY
    // RULE, §1/§4). `has_estimate` still flags that a miss is present.
    totals: sumNutrients(items.filter((it) => it.per100.source !== 'estimate')),
    portion_state: approximate ? 'estimated' : 'confirmed',
    approximate,
    flags: {
      has_estimate: items.some((it) => it.per100.source === 'estimate'),
      low_confidence: items.some((it) => it.confidence < LOW_CONFIDENCE_FLOOR),
    },
  };
}

function coerceMinerals(raw: unknown): Minerals {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Minerals = {};
  for (const key of MINERAL_KEYS) {
    if (r[key] !== undefined && r[key] !== null) {
      const v = num(r[key]);
      if (v !== 0 || r[key] === 0) out[key] = v;
    }
  }
  return out;
}

const SOURCES: readonly NutritionSource[] = [
  'usda',
  'skurikhin',
  'openfoodfacts',
  'apininjas',
  'fatsecret',
  'estimate',
];

/** Coerce a raw provider/cache per-100g into a valid `Per100`. */
export function coercePer100(raw: unknown): Per100 {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const source: NutritionSource = SOURCES.includes(r.source as NutritionSource)
    ? (r.source as NutritionSource)
    : 'estimate';
  return {
    source,
    kcal: Math.max(0, Math.round(num(r.kcal))),
    prot: round1(Math.max(0, num(r.prot))),
    fat: round1(Math.max(0, num(r.fat))),
    carb: round1(Math.max(0, num(r.carb))),
    minerals: coerceMinerals(r.minerals),
  };
}

/**
 * Validate + normalize a raw LLM identification payload into `IdentifiedItem[]`.
 * Pure and total: never throws. Garbage in → an empty list (handoff: never 500).
 */
export function normalizeIdentified(payload: unknown): IdentifiedItem[] {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(p.items) ? p.items : [];
  const items: IdentifiedItem[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name_ru = typeof r.name_ru === 'string' ? r.name_ru.trim() : '';
    const name_en = typeof r.name_en === 'string' ? r.name_en.trim() : '';
    if (name_ru.length === 0 && name_en.length === 0) continue;
    const grams = round1(Math.max(0, num(r.est_grams)));
    const confidence = Math.min(1, Math.max(0, num(r.confidence)));
    const item: IdentifiedItem = {
      name_ru: name_ru || name_en,
      name_en: name_en || name_ru,
      est_grams: grams > 0 ? grams : 100, // a sane default portion when omitted
      confidence,
    };
    if (typeof r.raw_text === 'string' && r.raw_text.trim().length > 0) {
      item.raw_text = r.raw_text.trim();
    }
    items.push(item);
  }
  return items;
}

/** Empty draft for unrecognized input — client shows "не удалось распознать". */
export function emptyMealDraft(region: Region): MealDraft {
  return {
    region,
    items: [],
    totals: { kcal: 0, prot: 0, fat: 0, carb: 0, minerals: {} },
    portion_state: 'estimated',
    approximate: false,
    flags: { has_estimate: false, low_confidence: false },
  };
}
