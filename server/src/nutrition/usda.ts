import type { Minerals, Per100, Region } from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { rankByName, scoreToConfidence } from './scoring.js';

const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

/**
 * USDA FoodData Central nutrient numbers. Foundation / SR Legacy foods report
 * values per 100 g, which is exactly the per-100g basis we want.
 */
const NUTRIENT_NUMBERS = {
  kcal: '1008', // Energy (kcal); legacy '208' handled below
  prot: '1003', // Protein
  fat: '1004', // Total lipid (fat)
  carb: '1005', // Carbohydrate, by difference
} as const;

const MINERAL_NUMBERS: Record<keyof Minerals, string> = {
  na: '1093', // Sodium, Na
  k: '1092', // Potassium, K
  ca: '1087', // Calcium, Ca
  mg: '1090', // Magnesium, Mg
  fe: '1089', // Iron, Fe
  zn: '1095', // Zinc, Zn
};

const KCAL_LEGACY = '208';

/** Prefer curated, per-100g data types over branded (which uses serving sizes). */
const DATA_TYPES = ['Foundation', 'SR Legacy'];

interface UsdaNutrient {
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

function nutrientValue(nutrients: UsdaNutrient[], wanted: string): number | undefined {
  for (const n of nutrients) {
    const number = n.nutrientNumber ?? n.number;
    if (number === wanted) {
      const v = n.value ?? n.amount;
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

function toPer100(food: UsdaFood): Per100 {
  const nutrients = food.foodNutrients ?? [];
  const kcal = nutrientValue(nutrients, NUTRIENT_NUMBERS.kcal) ?? nutrientValue(nutrients, KCAL_LEGACY) ?? 0;
  const minerals: Minerals = {};
  for (const key of Object.keys(MINERAL_NUMBERS) as (keyof Minerals)[]) {
    const v = nutrientValue(nutrients, MINERAL_NUMBERS[key]);
    if (typeof v === 'number') minerals[key] = v;
  }
  return {
    source: 'usda',
    kcal: Math.round(kcal),
    prot: nutrientValue(nutrients, NUTRIENT_NUMBERS.prot) ?? 0,
    fat: nutrientValue(nutrients, NUTRIENT_NUMBERS.fat) ?? 0,
    carb: nutrientValue(nutrients, NUTRIENT_NUMBERS.carb) ?? 0,
    minerals,
  };
}

/**
 * US nutrition via USDA FoodData Central `foods/search` (free, has minerals).
 *
 * Default match policy (BUILD SPEC §10): take the top-ranked Foundation/SR
 * Legacy result — no fuzzy re-scoring. USDA's own search score is mapped to a
 * 0..1 confidence (clamped) so the resolver can rank across providers.
 */
export class UsdaProvider implements NutritionProvider {
  readonly name = 'usda';
  readonly regions = ['US'] as const;

  constructor(private readonly apiKey: string) {}

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    return (await this.searchMany(name, region))[0] ?? null;
  }

  /**
   * Ranked candidates, best-first. USDA returns its own search score, but we
   * re-rank by NAME similarity (scoring.ts) so "rice" prefers plain rice over a
   * higher-USDA-scored "rice, fried". Non-foods (no kcal/protein) are dropped.
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
      const per100 = toPer100(c.value);
      // A real food must at least carry calories or protein.
      if (per100.kcal === 0 && per100.prot === 0) continue;
      out.push({ per100, name: c.value.description ?? name, confidence: scoreToConfidence(c.score) });
    }
    return out;
  }
}
