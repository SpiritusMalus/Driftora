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
 *   US → [Usda, Community, FatSecret, OpenFoodFacts(text+barcode), ApiNinjas]
 *   RU → [Skurikhin, Usda(by name_en), Community, FatSecret, OpenFoodFacts(text+barcode), ApiNinjas]
 *
 * Construction order IS the chain order; the resolver filters by region.
 * Skurikhin (curated RU dishes) always leads the RU chain; USDA then serves as
 * the broad free-text fallback for BOTH regions — for RU it is queried with
 * the item's English name (`queryLang: 'en'`), which the LLM always returns.
 * Open Food Facts free-text search covers branded products (RU names included);
 * FatSecret/ApiNinjas remain optional keyed fallbacks.
 *
 * The SHARED base (`community`, opt-in, filled by people logging) sits after the
 * composition tables and before the broad crowd/branded sources. That position
 * is the whole argument: a measured table must always win for foods it actually
 * has (борщ stays Skurikhin's борщ), while a local dish no table carries —
 * шаурма, хачапури, домашние сырники — reaches the community row instead of
 * falling through to a branded product that merely shares a word. Passed in
 * rather than built here so the same store instance also serves the contribute
 * route; omitted (unconfigured deployment, tests) ⇒ the chain is exactly as it
 * was before the feature existed.
 */
export function buildProviders(community?: NutritionProvider): NutritionProvider[] {
  const providers: NutritionProvider[] = [];
  // RU-first and US-first cores. The resolver filters by region, so order here
  // IS the per-region chain order.
  providers.push(new SkurikhinProvider());
  providers.push(new UsdaProvider(process.env.USDA_API_KEY || ''));
  if (community) providers.push(community);
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
