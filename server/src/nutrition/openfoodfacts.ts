import { TIMEOUT_MS } from '../httpTimeout.js';
import type { Minerals, Per100, Region } from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { rankByName, scoreToConfidence } from './scoring.js';

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * OFF free-text search. The newer `search.openfoodfacts.org` (search-a-licious)
 * service is down for us — it 502s on every query (verified 2026-07-13) — so we
 * use the classic `cgi/search.pl`, which is alive and IS where the branded RU
 * long tail lives («Сыр Тысяча Озёр Лёгкий», сырки, йогурты). It is slow (~5 s)
 * and needs `action=process&json=1`; results come back under `products`.
 */
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

/** OFF etiquette: identify the app on every request. */
const USER_AGENT = 'Driftora/1.0 (food-parse; support@family-pie.ru)';

/** Crowd-sourced rows never outrank a curated/USDA hit on confidence alone. */
const MAX_SEARCH_CONFIDENCE = 0.85;

// cgi/search.pl regularly takes ~5 s; give it room but never hold a parse
// hostage forever — a timeout just yields an empty list and the chain moves on.
const SEARCH_TIMEOUT_MS = 8000;
const SEARCH_PAGE_SIZE = 10;

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

/** kcal per 100g, falling back from the kcal field to the kJ variants. */
function kcalOf(nutriments: OffNutriments): number | undefined {
  const kcal = n(nutriments, 'energy-kcal_100g');
  if (typeof kcal === 'number') return kcal;
  const kj = n(nutriments, 'energy-kj_100g') ?? n(nutriments, 'energy_100g');
  return typeof kj === 'number' ? kj / 4.184 : undefined;
}

function toPer100(nutriments: OffNutriments): Per100 {
  const minerals: Minerals = {};
  for (const key of Object.keys(MINERAL_FIELDS) as (keyof Minerals)[]) {
    const grams = n(nutriments, MINERAL_FIELDS[key]);
    if (typeof grams === 'number') minerals[key] = grams * 1000; // g → mg
  }
  // Extended label — kept only when the crowd row actually has the field.
  const fiber = n(nutriments, 'fiber_100g');
  const sugar = n(nutriments, 'sugars_100g');
  const satFat = n(nutriments, 'saturated-fat_100g');
  return {
    source: 'openfoodfacts',
    kcal: Math.round(kcalOf(nutriments) ?? 0),
    prot: n(nutriments, 'proteins_100g') ?? 0,
    fat: n(nutriments, 'fat_100g') ?? 0,
    carb: n(nutriments, 'carbohydrates_100g') ?? 0,
    ...(fiber !== undefined ? { fiber } : {}),
    ...(sugar !== undefined ? { sugar } : {}),
    ...(satFat !== undefined ? { satFat } : {}),
    minerals,
  };
}

interface OffSearchProduct {
  product_name?: string;
  product_name_ru?: string;
  nutriments?: OffNutriments;
}

/**
 * Open Food Facts lookup (free, crowd-sourced). Two modes:
 *  - barcode → exact product fetch (`search`);
 *  - free text → the OFF search API (`searchMany`), which is what covers
 *    branded RU products (сырки, йогурты, колбасы…) no curated table can.
 * Crowd data is honest but uneven, so rows missing any of kcal/prot/fat/carb
 * are dropped and confidence is capped below curated/USDA levels.
 */
export class OpenFoodFactsProvider implements NutritionProvider {
  readonly name = 'openfoodfacts';
  readonly regions = ['RU', 'US'] as const;

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    if (!isBarcode(name)) return (await this.searchMany(name, region))[0] ?? null;
    const barcode = name.trim();

    let res: Response;
    try {
      res = await fetch(`${PRODUCT_URL}/${barcode}.json`, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS.openfoodfacts),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as
      | { status?: number; product?: { nutriments?: OffNutriments } }
      | null;
    const nutriments = data?.product?.nutriments;
    if (data?.status !== 1 || !nutriments) return null;

    // A kcal-only crowd row would render as real calories over fabricated
    // Б0/Ж0/У0 — a product with no macro fields at all is unusable.
    const hasMacroFields =
      n(nutriments, 'proteins_100g') !== undefined ||
      n(nutriments, 'fat_100g') !== undefined ||
      n(nutriments, 'carbohydrates_100g') !== undefined;
    if (!hasMacroFields) return null;

    const per100 = toPer100(nutriments);
    if (per100.kcal === 0 && per100.prot === 0) return null;
    return { per100, confidence: 0.9 };
  }

  /** Ranked free-text candidates from the OFF search API (best-first). */
  async searchMany(name: string, region: Region): Promise<ProviderResult[]> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return [];
    if (isBarcode(trimmed)) {
      const one = await this.search(trimmed, region);
      return one ? [one] : [];
    }

    const url = new URL(SEARCH_URL);
    url.searchParams.set('search_terms', trimmed);
    url.searchParams.set('search_simple', '1');
    url.searchParams.set('action', 'process'); // classic API runs the search only with this
    url.searchParams.set('json', '1');
    url.searchParams.set('page_size', String(SEARCH_PAGE_SIZE));
    url.searchParams.set('fields', 'product_name,product_name_ru,nutriments');

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT },
        // OFF is community infra and can stall; never hold the parse hostage.
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });
    } catch {
      return [];
    }
    if (!res.ok) return [];

    const data = (await res.json().catch(() => null)) as { products?: OffSearchProduct[] } | null;
    const products = data?.products ?? [];

    const usable = products.flatMap((p) => {
      const nutriments = p.nutriments;
      const displayName = (region === 'RU' ? p.product_name_ru || p.product_name : p.product_name)?.trim();
      if (!nutriments || !displayName) return [];
      // Require the full macro row — crowd entries missing any of them are out.
      if (
        kcalOf(nutriments) === undefined ||
        n(nutriments, 'proteins_100g') === undefined ||
        n(nutriments, 'fat_100g') === undefined ||
        n(nutriments, 'carbohydrates_100g') === undefined
      ) {
        return [];
      }
      const per100 = toPer100(nutriments);
      if (per100.kcal === 0 && per100.prot === 0) return [];
      return [{ per100, name: displayName }];
    });

    return rankByName(
      trimmed,
      usable.map((u) => ({ value: u, name: u.name })),
    ).map((c) => ({
      per100: c.value.per100,
      name: c.value.name,
      confidence: Math.min(scoreToConfidence(c.score), MAX_SEARCH_CONFIDENCE),
    }));
  }
}
