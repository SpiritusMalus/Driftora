import { ApiNinjasProvider } from './nutrition/apininjas.js';
import { OpenFoodFactsProvider } from './nutrition/openfoodfacts.js';
import type { NutritionProvider } from './nutrition/provider.js';
import { Resolver } from './nutrition/resolver.js';
import { UsdaProvider } from './nutrition/usda.js';
import { assembleMealDraft, type IdentifiedItem, type MealDraft, type Region } from './types.js';

/**
 * Build the region-aware provider chains (BUILD SPEC §5.2):
 *   US → [Usda, OpenFoodFacts(barcode), ApiNinjas]
 *   RU → [Skurikhin, OpenFoodFacts(barcode), ApiNinjas]   (Skurikhin = Phase 2)
 *
 * Construction order IS the chain order; the resolver filters by region. Open
 * Food Facts and API Ninjas serve both regions; USDA is US-only.
 */
export function buildProviders(): NutritionProvider[] {
  const providers: NutritionProvider[] = [];
  providers.push(new UsdaProvider(process.env.USDA_API_KEY || ''));
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
