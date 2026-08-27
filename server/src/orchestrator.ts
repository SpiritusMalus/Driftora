import { readFileSync } from 'node:fs';

import { ApiNinjasProvider } from './nutrition/apininjas.js';
import { FatSecretProvider } from './nutrition/fatsecret.js';
import { BarcodeIndex } from './nutrition/barcodeIndex.js';
import { OffLocalProvider } from './nutrition/offLocal.js';
import { OpenFoodFactsProvider } from './nutrition/openfoodfacts.js';
import { setKnownBrands } from './nutrition/specificity.js';
import type { NutritionProvider } from './nutrition/provider.js';
import { Resolver } from './nutrition/resolver.js';
import { SkurikhinProvider } from './nutrition/skurikhin.js';
import { UsdaProvider } from './nutrition/usda.js';
import { assembleMealDraft, type IdentifiedItem, type MealDraft, type Region } from './types.js';

/**
 * Build the region-aware provider chains (BUILD SPEC §5.2):
 *   US → [Usda, Community, FatSecret, OpenFoodFacts(text+barcode), ApiNinjas]
 *   RU → [Skurikhin, FatSecret, Usda(by name_en), Community, OpenFoodFacts(text+barcode), ApiNinjas]
 *
 * Construction order IS the chain order; the resolver filters by region.
 * Skurikhin (curated RU dishes) always leads the RU chain. In the RU chain
 * FatSecret comes NEXT (owner decision 2026-08-26): it is the one external
 * source with RU localization (`region=RU&language=ru`), so a food the curated
 * table misses is answered by RU-labelled rows before USDA's English corpus —
 * whose answers must survive our own translation, where brands die (#209).
 * The measured table still beats it for everything it actually carries, and
 * the US chain keeps USDA first. USDA then serves as the broad free-text
 * fallback for BOTH regions — for RU it is queried with the item's English
 * name (`queryLang: 'en'`), which the LLM always returns.
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
/**
 * Loads the local OFF snapshot and the brand dictionary beside it. Both are
 * DEPLOY ARTIFACTS, not repo content: the data is ODbL-licensed and belongs to
 * Open Food Facts (attributed on every row via `source: 'openfoodfacts'`), and
 * this repository is public. A missing or unreadable file is not an error — the
 * service simply runs without the snapshot, exactly as it did before.
 */
function loadOffLocal(): OffLocalProvider | undefined {
  const path = process.env.OFF_LOCAL_PATH || '';
  if (!path) return undefined;
  // Индекс по штрихкодам — тот же снимок, другой срез (весь мир, поиск по коду).
  // Отдельная переменная, потому что это ~100 МБ на диске: развёртывание без
  // сканера кодов может его не класть, и всё остальное продолжит работать.
  let barcodes: BarcodeIndex | undefined;
  const barcodePrefix = process.env.OFF_BARCODES_PATH || '';
  if (barcodePrefix) {
    try {
      barcodes = BarcodeIndex.open(`${barcodePrefix}.bin`, `${barcodePrefix}.names`);
      console.log(`[off-local] индекс штрихкодов: ${barcodes.size} товаров`);
    } catch (err) {
      console.error(`[off-local] индекс штрихкодов не открылся: ${(err as Error).message}`);
    }
  }
  let provider: OffLocalProvider;
  try {
    provider = OffLocalProvider.fromFile(path, barcodes);
  } catch (err) {
    console.error(`[off-local] не прочитался ${path}: ${(err as Error).message} — работаем без снимка`);
    return undefined;
  }
  const brandsPath = process.env.OFF_BRANDS_PATH || path.replace(/\.jsonl$/, '-brands.txt');
  try {
    const brands = readFileSync(brandsPath, 'utf8').split('\n').filter((b) => b.trim().length > 0);
    setKnownBrands(brands);
    console.log(`[off-local] ${provider.size} продуктов, ${brands.length} марок`);
  } catch {
    console.log(`[off-local] ${provider.size} продуктов, словарь марок не найден (${brandsPath})`);
  }
  return provider;
}

/**
 * The same provider, narrowed to [regions] — lets ONE FatSecret instance (one
 * OAuth token cache, one 401-recovery path) occupy DIFFERENT positions in the
 * RU and US chains. Plain delegation, not a spread: the instance's methods
 * live on its prototype and must keep their `this`.
 */
function forRegions(p: NutritionProvider, regions: readonly Region[]): NutritionProvider {
  return {
    name: p.name,
    regions,
    ...(p.queryLang !== undefined ? { queryLang: p.queryLang } : {}),
    ...(p.acceptsCyrillic !== undefined ? { acceptsCyrillic: p.acceptsCyrillic } : {}),
    search: (name, region) => p.search(name, region),
    ...(p.searchMany ? { searchMany: (name: string, region: Region) => p.searchMany!(name, region) } : {}),
  };
}

export function buildProviders(community?: NutritionProvider): NutritionProvider[] {
  const providers: NutritionProvider[] = [];
  const fatSecret =
    process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET
      ? new FatSecretProvider(process.env.FATSECRET_CLIENT_ID, process.env.FATSECRET_CLIENT_SECRET)
      : null;
  // RU-first and US-first cores. The resolver filters by region, so order here
  // IS the per-region chain order.
  providers.push(new SkurikhinProvider());
  // RU slot: right after the measured table (see the chain doc above). The US
  // slot for the SAME instance sits further down, after community.
  if (fatSecret) providers.push(forRegions(fatSecret, ['RU']));
  providers.push(new UsdaProvider(process.env.USDA_API_KEY || ''));
  if (community) providers.push(community);
  // LOCAL copy of the RU part of Open Food Facts (scripts/offRuImport.ts), when
  // deployed. It sits AHEAD of the English sources because it is the only one
  // that can explain a brand: «отруби овсяные мистраль» is answered here in
  // microseconds instead of losing the brand in translation and then depending
  // on OFF's public API, which throttles anonymous traffic (503) — the outage
  // that started all of this. Absent file ⇒ the chain is exactly as before.
  const offLocal = loadOffLocal();
  if (offLocal) providers.push(offLocal);
  // US slot of the SAME FatSecret instance: broad keyed fallback after the
  // measured tables and the community base, exactly where it always sat.
  if (fatSecret) providers.push(forRegions(fatSecret, ['US']));
  // The live API stays LAST: it is the freshest (a product added to OFF today is
  // not in our snapshot) but also the only one that can be throttled.
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
