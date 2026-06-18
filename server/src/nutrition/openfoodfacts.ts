import type { Minerals, Per100, Region } from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

/** OFF stores per-100g nutriments; minerals are in grams → convert to mg. */
const MINERAL_FIELDS: Record<keyof Minerals, string> = {
  na: 'sodium_100g',
  k: 'potassium_100g',
  ca: 'calcium_100g',
  mg: 'magnesium_100g',
  fe: 'iron_100g',
  zn: 'zinc_100g',
};

interface OffNutriments {
  [key: string]: number | string | undefined;
}

function n(nutriments: OffNutriments, key: string): number | undefined {
  const v = nutriments[key];
  const num = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(num) ? num : undefined;
}

/** True when the lookup name is a plain barcode (8–14 digits). */
export function isBarcode(name: string): boolean {
  return /^\d{8,14}$/.test(name.trim());
}

/**
 * Open Food Facts barcode lookup (free). Only fires when the name is a barcode;
 * for plain text names it returns null and the chain moves on. Region selects
 * the OFF locale subdomain but the global DB is used here for v1.
 */
export class OpenFoodFactsProvider implements NutritionProvider {
  readonly name = 'openfoodfacts';
  readonly regions = ['RU', 'US'] as const;

  async search(name: string, _region: Region): Promise<ProviderResult | null> {
    if (!isBarcode(name)) return null;
    const barcode = name.trim();

    let res: Response;
    try {
      res = await fetch(`${PRODUCT_URL}/${barcode}.json`, { method: 'GET' });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as
      | { status?: number; product?: { nutriments?: OffNutriments } }
      | null;
    const nutriments = data?.product?.nutriments;
    if (data?.status !== 1 || !nutriments) return null;

    const kcal = n(nutriments, 'energy-kcal_100g') ?? 0;
    const minerals: Minerals = {};
    for (const key of Object.keys(MINERAL_FIELDS) as (keyof Minerals)[]) {
      const grams = n(nutriments, MINERAL_FIELDS[key]);
      if (typeof grams === 'number') minerals[key] = grams * 1000; // g → mg
    }
    const per100: Per100 = {
      source: 'openfoodfacts',
      kcal: Math.round(kcal),
      prot: n(nutriments, 'proteins_100g') ?? 0,
      fat: n(nutriments, 'fat_100g') ?? 0,
      carb: n(nutriments, 'carbohydrates_100g') ?? 0,
      minerals,
    };
    if (per100.kcal === 0 && per100.prot === 0) return null;
    return { per100, confidence: 0.9 };
  }
}
