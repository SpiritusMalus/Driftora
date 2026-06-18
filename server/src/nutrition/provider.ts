import type { Per100, Region } from '../types.js';

/** A per-100g lookup result from one source, with a 0..1 match confidence. */
export interface ProviderResult {
  per100: Per100;
  confidence: number;
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
  search(name: string, region: Region): Promise<ProviderResult | null>;
}
