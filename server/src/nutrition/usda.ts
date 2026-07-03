import type { Minerals, Per100, Region } from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { rankByName, scoreToConfidence } from './scoring.js';

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/**
 * FDC nutrient identifiers. Foundation / SR Legacy / FNDDS foods report values
 * per 100 g, which is exactly the per-100g basis we want.
 *
 * The live `/foods/search` response carries the modern id in `nutrientId` (a
 * NUMBER) and the LEGACY SR number in `nutrientNumber` (e.g. Protein comes as
 * `{nutrientId: 1003, nutrientNumber: '203'}`) — so every nutrient must match
 * by either key. Matching modern ids against `nutrientNumber` alone reads kcal
 * (via its legacy fallback) but silently zeroes protein/fat/carb.
 */
interface NutrientKey {
  id: number; // modern FDC id, in `nutrientId`
  legacy: string; // legacy SR number, in `nutrientNumber`
}

const NUTRIENT_KEYS = {
  kcal: { id: 1008, legacy: '208' }, // Energy (kcal)
  prot: { id: 1003, legacy: '203' }, // Protein
  fat: { id: 1004, legacy: '204' }, // Total lipid (fat)
  carb: { id: 1005, legacy: '205' }, // Carbohydrate, by difference
} as const;

/** Extended label (grams per 100 g): fiber / total sugars / saturated fat. */
const EXTRA_KEYS = {
  fiber: { id: 1079, legacy: '291' }, // Fiber, total dietary
  sugar: { id: 2000, legacy: '269' }, // Sugars, total
  sugarNlea: { id: 1063, legacy: '269.3' }, // Sugars, total incl. NLEA (Foundation)
  satFat: { id: 1258, legacy: '606' }, // Fatty acids, total saturated
} as const;

const MINERAL_KEYS: Record<keyof Minerals, NutrientKey> = {
  na: { id: 1093, legacy: '307' }, // Sodium, Na
  k: { id: 1092, legacy: '306' }, // Potassium, K
  ca: { id: 1087, legacy: '301' }, // Calcium, Ca
  mg: { id: 1090, legacy: '304' }, // Magnesium, Mg
  fe: { id: 1089, legacy: '303' }, // Iron, Fe
  zn: { id: 1095, legacy: '309' }, // Zinc, Zn
};

/**
 * Prefer curated, per-100g data types over branded (which uses serving sizes).
 * Survey (FNDDS) is included for its composite/cooked dishes (soups, stews,
 * stroganoff…) — also per-100g — which the ingredient-only sets lack.
 */
const DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];

interface UsdaNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  number?: string;
  value?: number;
  amount?: number;
}

interface UsdaFood {
  description?: string;
  score?: number;
  foodNutrients?: UsdaNutrient[];
}

function nutrientValue(nutrients: UsdaNutrient[], key: NutrientKey): number | undefined {
  for (const n of nutrients) {
    const number = n.nutrientNumber ?? n.number;
    // `number === String(key.id)` keeps endpoints/fixtures that put the modern
    // id into `nutrientNumber` working.
    if (n.nutrientId !== key.id && number !== key.legacy && number !== String(key.id)) continue;
    const v = n.value ?? n.amount;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Parsed per-100g fields; each stays `undefined` when the record lacks it. */
interface RawPer100 {
  kcal?: number;
  prot?: number;
  fat?: number;
  carb?: number;
  fiber?: number;
  sugar?: number;
  satFat?: number;
  minerals: Minerals;
}

function extract(food: UsdaFood): RawPer100 {
  const nutrients = food.foodNutrients ?? [];
  const minerals: Minerals = {};
  for (const key of Object.keys(MINERAL_KEYS) as (keyof Minerals)[]) {
    const v = nutrientValue(nutrients, MINERAL_KEYS[key]);
    if (typeof v === 'number') minerals[key] = v;
  }
  return {
    kcal: nutrientValue(nutrients, NUTRIENT_KEYS.kcal),
    prot: nutrientValue(nutrients, NUTRIENT_KEYS.prot),
    fat: nutrientValue(nutrients, NUTRIENT_KEYS.fat),
    carb: nutrientValue(nutrients, NUTRIENT_KEYS.carb),
    fiber: nutrientValue(nutrients, EXTRA_KEYS.fiber),
    sugar: nutrientValue(nutrients, EXTRA_KEYS.sugar) ?? nutrientValue(nutrients, EXTRA_KEYS.sugarNlea),
    satFat: nutrientValue(nutrients, EXTRA_KEYS.satFat),
    minerals,
  };
}

/**
 * US nutrition via USDA FoodData Central `foods/search` (free, has minerals).
 *
 * Default match policy (BUILD SPEC §10): take the top-ranked Foundation/SR
 * Legacy result — no fuzzy re-scoring. USDA's own search score is mapped to a
 * 0..1 confidence (clamped) so the resolver can rank across providers.
 *
 * Also serves the RU chain as the broad free-text fallback AFTER the curated
 * RU table: `queryLang: 'en'` makes the resolver query it with the item's
 * `name_en` (the LLM always returns one), since the FDC corpus is English.
 * Nutrition of generic foods doesn't depend on the market; RU-specific dishes
 * are (and must stay) covered by the curated table first.
 */
export class UsdaProvider implements NutritionProvider {
  readonly name = 'usda';
  readonly regions = ['US', 'RU'] as const;
  readonly queryLang = 'en' as const;

  constructor(private readonly apiKey: string) {}

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    return (await this.searchMany(name, region))[0] ?? null;
  }

  /**
   * Ranked candidates, best-first. USDA returns its own search score, but we
   * re-rank by NAME similarity (scoring.ts) so "rice" prefers plain rice over a
   * higher-USDA-scored "rice, fried". Non-foods (no kcal/protein) are dropped,
   * and so are records whose macros we can't read at all — zero-filling those
   * would show real calories over fabricated Б0/Ж0/У0.
   */
  async searchMany(name: string, _region: Region): Promise<ProviderResult[]> {
    if (!this.apiKey || name.trim().length === 0) return [];
    const url = new URL(SEARCH_URL);
    url.searchParams.set('api_key', this.apiKey);
    url.searchParams.set('query', name);
    url.searchParams.set('dataType', DATA_TYPES.join(','));
    url.searchParams.set('pageSize', '10');

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET' });
    } catch {
      return [];
    }
    if (!res.ok) return [];

    const data = (await res.json().catch(() => null)) as { foods?: UsdaFood[] } | null;
    const foods = (data?.foods ?? []).filter((f) => Array.isArray(f.foodNutrients));

    const ranked = rankByName(
      name,
      foods.map((f) => ({ value: f, name: f.description ?? '' })),
    );

    const out: ProviderResult[] = [];
    for (const c of ranked) {
      const raw = extract(c.value);
      const kcal = raw.kcal ?? 0;
      // A real food must at least carry calories or protein.
      if (kcal === 0 && (raw.prot ?? 0) === 0) continue;
      // Calories but not a single macro FIELD (absent ≠ an explicit 0, which
      // spirits legitimately have) means the record is incomplete or its shape
      // drifted from what we parse — fall through to the next candidate/source.
      if (raw.prot === undefined && raw.fat === undefined && raw.carb === undefined) continue;
      const per100: Per100 = {
        source: 'usda',
        kcal: Math.round(kcal),
        prot: raw.prot ?? 0,
        fat: raw.fat ?? 0,
        carb: raw.carb ?? 0,
        // Extended label passes through only when the record has it.
        ...(raw.fiber !== undefined ? { fiber: raw.fiber } : {}),
        ...(raw.sugar !== undefined ? { sugar: raw.sugar } : {}),
        ...(raw.satFat !== undefined ? { satFat: raw.satFat } : {}),
        minerals: raw.minerals,
      };
      out.push({ per100, name: c.value.description ?? name, confidence: scoreToConfidence(c.score) });
    }
    return out;
  }
}
