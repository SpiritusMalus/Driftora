import type { Per100, Region } from '../types.js';

/** A per-100g lookup result from one source, with a 0..1 match confidence. */
export interface ProviderResult {
  per100: Per100;
  confidence: number;
  /** The matched candidate's display name (for the "не то?" alternatives UI). */
  name?: string;
}

/**
 * A single nutrition source (USDA, Skurikhin, Open Food Facts, …). Returns the
 * EXACT per-100g composition for a food name, or `null` on a miss. Providers are
 * pluggable and region-aware via the resolver's chains (BUILD SPEC §5.2).
 */
export interface NutritionProvider {
  readonly name: string;
  /** Region(s) this provider serves; the resolver only calls it for those. */
  readonly regions: readonly Region[];
  /**
   * Optional: the query language this source understands. An English-only DB
   * (USDA) declares 'en' so the resolver queries it with the item's `name_en`
   * even in the RU chain (the LLM always returns both names). Omit to receive
   * the region-native name (RU → name_ru, US → name_en).
   */
  readonly queryLang?: 'en' | 'ru';
  /** Best single match (or null). For list sources this is `searchMany()[0]`. */
  search(name: string, region: Region): Promise<ProviderResult | null>;
  /**
   * Optional: ranked candidates, best-first, for sources that return a LIST
   * (FatSecret, USDA, API Ninjas). The resolver uses the head as the primary
   * match and the tail as user-switchable alternatives (disambiguation). Single-
   * row sources (a barcode lookup, a curated table) omit this.
   */
  searchMany?(name: string, region: Region): Promise<ProviderResult[]>;
}
