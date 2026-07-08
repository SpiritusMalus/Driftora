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

/**
 * Where a per-100g number came from. `estimate` = DB miss (coarse, not fact).
 * `label` = read verbatim off the product's own nutrition panel in a photo —
 * ground truth transcribed, not the model guessing (THE HONESTY RULE holds:
 * the numbers are printed on the package, the model only transcribes them).
 */
export type NutritionSource =
  | 'usda'
  | 'skurikhin'
  | 'openfoodfacts'
  | 'apininjas'
  | 'fatsecret'
  | 'label'
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

/**
 * Vitamin set (per 100 g or scaled). Units match the client's reference norms
 * (microNutrients.ts): µg for a/d/b9/b12, mg for e/c/b1/b2/b6. Like `Minerals`,
 * ANY subset may be present — a field exists only when the source measured it,
 * never zero-filled. Only USDA carries these today; RU curated / OFF omit them.
 */
export interface Vitamins {
  a?: number;
  d?: number;
  e?: number;
  c?: number;
  b1?: number;
  b2?: number;
  b6?: number;
  b9?: number;
  b12?: number;
}

/** Macros + minerals + vitamins for a fixed quantity (per-100g or scaled). */
export interface NutrientValues {
  kcal: number;
  // Extended-label fields (grams). Present ONLY when the source provides the
  // field — never zero-filled, so a 0 is always a real zero, not missing data.
  fiber?: number;
  sugar?: number;
  satFat?: number;
  prot: number;
  fat: number;
  carb: number;
  minerals: Minerals;
  // Optional so the contract stays backward-compatible across a staged rollout
  // (an old server/client without vitamins still validates). Same "present only
  // when measured" rule as minerals — an absent vitamin is unknown, not zero.
  vitamins?: Vitamins;
}

/** EXACT per-100g composition from the nutrition DB (or a coarse `estimate`). */
export interface Per100 extends NutrientValues {
  source: NutritionSource;
}

/**
 * Numbers transcribed off a packaged product's nutrition panel in a PHOTO
 * (Phase: label-reading). This is the ONE place the model may carry nutrition
 * numbers — because it is reading printed ground truth, not estimating. Every
 * field is optional: present only when clearly legible on the package, never
 * guessed to fill a gap. Per-100g macros + net weight (масса нетто).
 */
export interface LabelReading {
  kcal_100g?: number;
  prot_100g?: number;
  fat_100g?: number;
  carb_100g?: number;
  net_weight_g?: number;
}

/** Layer 1/2 output — identification only, NO nutrition numbers (§4). */
export interface IdentifiedItem {
  name_ru: string;
  name_en: string;
  est_grams: number;
  confidence: number; // 0..1
  // The model's signal that the named item is an already-prepared dish eaten
  // as-is (soup, stew, salad, ready meal). Only `true` is carried — absence
  // means "no signal", and the curated-table flag can still set it downstream.
  prepared?: boolean;
  // Photo path only: numbers read off the product's own label, when visible.
  // The resolver prefers these over a name-based DB lookup (source: 'label').
  label?: LabelReading;
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
  // TRANSPARENCY: the display name of the DB row the numbers actually came
  // from («картошка» resolves to «картофель варёный» — the user must SEE
  // that, incl. the preparation state the row name carries). Absent on a full
  // miss (estimate has no row).
  matched_name?: string;
  // The component is an already-prepared dish consumed as-is (soup, salad,
  // ready meal) — from the curated-table flag or the LLM signal. Its per-100g
  // baseline already describes the FINISHED dish, so the client hides the
  // cooking-method adjustment (it would double-count). Only `true` is sent.
  prepared?: boolean;
  // Other ranked DB matches for the same item (best-first), present when the
  // source returned >1 candidate. The client offers them behind "не то?" and
  // shows the picker proactively when confidence is low.
  alternatives?: NutritionAlternative[];
  // HONESTY hint: the matched row's per-100g looks like a DRY-product label
  // (instant noodles / pasta / rice) while the weight is most likely the COOKED
  // dish — so `grams × per100` overcounts ~3× (absorbed water). We don't rewrite
  // the numbers; the client shows a "check the weight" note. Only `true` is sent.
  dry_basis?: boolean;
  // TRANSPARENCY: some of the vitamins/minerals here were BACK-FILLED from a
  // generic USDA record (by name_en) because the primary source (curated RU / a
  // crowd OFF product) carries no micronutrients. They're an approximate proxy,
  // not the exact product's lab values — the client labels them as such. Only
  // `true` is sent.
  micros_estimated?: boolean;
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
const VITAMIN_KEYS: readonly (keyof Vitamins)[] = ['a', 'd', 'e', 'c', 'b1', 'b2', 'b6', 'b9', 'b12'];
const EXTRA_KEYS = ['fiber', 'sugar', 'satFat'] as const;
const LOW_CONFIDENCE_FLOOR = 0.5;
/**
 * Upper bound on identified items per request (bug fix — 2026-07-05). The
 * orchestrator resolves every item concurrently (`Promise.all` over
 * `resolver.resolveItem`), so an LLM response (or a crafted/misbehaving one)
 * carrying an unbounded `items` array would fan out into an unbounded burst of
 * downstream nutrition-provider calls per single `/food/parse*` request. No
 * real meal has anywhere near this many components — this is amplification
 * protection, not a product limit.
 */
const MAX_ITEMS = 20;

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/// Vitamins are often sub-milligram (thiamin, B12) — 2 decimals so a small but
/// real amount doesn't round away to a fake zero.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/// Scale the vitamin sub-block to a factor, keeping only present keys (2 dp).
function scaleVitamins(vitamins: Vitamins | undefined, factor: number): Vitamins | undefined {
  if (!vitamins) return undefined;
  const out: Vitamins = {};
  let any = false;
  for (const key of VITAMIN_KEYS) {
    const v = vitamins[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = round2(v * factor);
      any = true;
    }
  }
  return any ? out : undefined;
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
  const out: NutrientValues = {
    kcal: Math.round(per100.kcal * factor),
    prot: round1(per100.prot * factor),
    fat: round1(per100.fat * factor),
    carb: round1(per100.carb * factor),
    minerals,
  };
  for (const key of EXTRA_KEYS) {
    const v = per100[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = round1(v * factor);
  }
  const vitamins = scaleVitamins(per100.vitamins, factor);
  if (vitamins) out.vitamins = vitamins;
  return out;
}

/** Sum scaled component values into a single totals block. */
export function sumNutrients(items: { scaled: NutrientValues }[]): NutrientValues {
  const minerals: Minerals = {};
  const vitamins: Vitamins = {};
  let anyVitamin = false;
  let kcal = 0;
  let prot = 0;
  let fat = 0;
  let carb = 0;
  // Extras sum like minerals do: over the items that HAVE the field (an
  // "at least this much" partial sum — the UI says so).
  const extras: Partial<Record<(typeof EXTRA_KEYS)[number], number>> = {};
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
    for (const key of VITAMIN_KEYS) {
      const v = it.scaled.vitamins?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        vitamins[key] = (vitamins[key] ?? 0) + v;
        anyVitamin = true;
      }
    }
    for (const key of EXTRA_KEYS) {
      const v = it.scaled[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        extras[key] = (extras[key] ?? 0) + v;
      }
    }
  }
  const out: NutrientValues = { kcal: Math.round(kcal), prot: round1(prot), fat: round1(fat), carb: round1(carb), minerals };
  for (const key of EXTRA_KEYS) {
    const v = extras[key];
    if (v !== undefined) out[key] = round1(v);
  }
  if (anyVitamin) {
    for (const key of VITAMIN_KEYS) {
      if (vitamins[key] !== undefined) vitamins[key] = round2(vitamins[key]!);
    }
    out.vitamins = vitamins;
  }
  return out;
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

/// Coerce a raw vitamins block; returns undefined when nothing usable is present
/// (keeps the "absent = unmeasured" invariant instead of an empty object).
function coerceVitamins(raw: unknown): Vitamins | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: Vitamins = {};
  let any = false;
  for (const key of VITAMIN_KEYS) {
    if (r[key] !== undefined && r[key] !== null) {
      const v = num(r[key]);
      if (v !== 0 || r[key] === 0) {
        out[key] = v;
        any = true;
      }
    }
  }
  return any ? out : undefined;
}

/** A finite, strictly-positive number, else undefined (drops 0/NaN/garbage). */
function posNum(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Coerce a raw label block off the photo model. Keeps only clearly-positive
 * numbers; returns undefined when nothing usable is present (so `label` stays
 * absent rather than an empty object). Per-100g macros are clamped to a sane
 * ceiling — no food exceeds 900 kcal or 100 g of any macro per 100 g, so an
 * OCR misread like "1050" is dropped rather than trusted.
 */
function coerceLabel(raw: unknown): LabelReading | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const macro = (v: unknown): number | undefined => {
    const n = posNum(v);
    return n !== undefined && n <= 100 ? round1(n) : undefined;
  };
  const kcalRaw = posNum(r.kcal_100g);
  const out: LabelReading = {};
  if (kcalRaw !== undefined && kcalRaw <= 900) out.kcal_100g = Math.round(kcalRaw);
  const prot = macro(r.prot_100g);
  const fat = macro(r.fat_100g);
  const carb = macro(r.carb_100g);
  if (prot !== undefined) out.prot_100g = prot;
  if (fat !== undefined) out.fat_100g = fat;
  if (carb !== undefined) out.carb_100g = carb;
  // Net weight: a real package is at most a few kg — reject implausible reads.
  const weight = posNum(r.net_weight_g);
  if (weight !== undefined && weight <= 5000) out.net_weight_g = round1(weight);
  return Object.keys(out).length > 0 ? out : undefined;
}

const SOURCES: readonly NutritionSource[] = [
  'usda',
  'skurikhin',
  'openfoodfacts',
  'apininjas',
  'fatsecret',
  'label',
  'estimate',
];

/** Coerce a raw provider/cache per-100g into a valid `Per100`. */
export function coercePer100(raw: unknown): Per100 {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const source: NutritionSource = SOURCES.includes(r.source as NutritionSource)
    ? (r.source as NutritionSource)
    : 'estimate';
  const out: Per100 = {
    source,
    kcal: Math.max(0, Math.round(num(r.kcal))),
    prot: round1(Math.max(0, num(r.prot))),
    fat: round1(Math.max(0, num(r.fat))),
    carb: round1(Math.max(0, num(r.carb))),
    minerals: coerceMinerals(r.minerals),
  };
  // Extended-label fields survive coercion only when actually present.
  for (const key of EXTRA_KEYS) {
    if (r[key] !== undefined && r[key] !== null) out[key] = round1(Math.max(0, num(r[key])));
  }
  const vitamins = coerceVitamins(r.vitamins);
  if (vitamins) out.vitamins = vitamins;
  return out;
}

/**
 * Validate + normalize a raw LLM identification payload into `IdentifiedItem[]`.
 * Pure and total: never throws. Garbage in → an empty list (handoff: never 500).
 */
export function normalizeIdentified(payload: unknown): IdentifiedItem[] {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  // Cap BEFORE processing — an oversized array must not even be walked in full.
  const rawItems = (Array.isArray(p.items) ? p.items : []).slice(0, MAX_ITEMS);
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
    // Strictly boolean true — "false"/1/garbage from a loose model stays off.
    if (r.prepared === true) item.prepared = true;
    // Photo label read-out, when the model transcribed a legible panel.
    const label = coerceLabel(r.label);
    if (label) item.label = label;
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
