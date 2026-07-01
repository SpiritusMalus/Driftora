import { ApiNinjasProvider } from './nutrition/apininjas.js';
import { FatSecretProvider } from './nutrition/fatsecret.js';
import { OpenFoodFactsProvider } from './nutrition/openfoodfacts.js';
import type { NutritionProvider } from './nutrition/provider.js';
import { Resolver } from './nutrition/resolver.js';
import { SkurikhinProvider } from './nutrition/skurikhin.js';
import { UsdaProvider } from './nutrition/usda.js';
import { assembleMealDraft, type IdentifiedItem, type MealDraft, type Region } from './types.js';

/**
 * Build the region-aware provider chains (BUILD SPEC §5.2):
 *   US → [Usda, FatSecret, OpenFoodFacts(barcode), ApiNinjas]
 *   RU → [Skurikhin, FatSecret, OpenFoodFacts(barcode), ApiNinjas]
 *
 * Construction order IS the chain order; the resolver filters by region. Open
 * Food Facts, API Ninjas and FatSecret serve both regions; USDA is US-only and
 * Skurikhin is RU-only. FatSecret sits right after the curated tables as the
 * broad free-text fallback (esp. for RU, where the curated table is small).
 */
export function buildProviders(): NutritionProvider[] {
  const providers: NutritionProvider[] = [];
  // RU-first and US-first cores. The resolver filters by region, so order here
  // IS the per-region chain order: RU → [Skurikhin, OFF, ApiNinjas];
  // US → [Usda, OFF, ApiNinjas].
  providers.push(new SkurikhinProvider());
  providers.push(new UsdaProvider(process.env.USDA_API_KEY || ''));
  // Broad free-text fallback (both regions) — only when credentials are set.
  if (process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET) {
    providers.push(new FatSecretProvider(process.env.FATSECRET_CLIENT_ID, process.env.FATSECRET_CLIENT_SECRET));
  }
  providers.push(new OpenFoodFactsProvider());
  if (process.env.APININJAS_KEY) {
    providers.push(new ApiNinjasProvider(process.env.APININJAS_KEY));
  }
  return providers;
}

/**
 * Turn identified items into a `MealDraft`: resolve each through the nutrition
 * DB (exact per-100g), scale to estimated grams, and recompute totals/flags
 * server-side so the wire result is always internally consistent (§5.1).
 */
export async function buildMealDraft(
  resolver: Resolver,
  items: IdentifiedItem[],
  region: Region,
): Promise<MealDraft> {
  const resolved = await Promise.all(items.map((it) => resolver.resolveItem(it, region)));
  return assembleMealDraft(region, resolved);
}
