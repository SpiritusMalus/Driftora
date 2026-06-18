import {
  coercePer100,
  scaleToGrams,
  type IdentifiedItem,
  type NutritionItem,
  type Per100,
  type Region,
} from '../types.js';
import type { NutritionProvider } from './provider.js';

/** Coarse per-100g used on a full DB miss — shown as an estimate, never fact. */
const ESTIMATE_PER100: Per100 = {
  source: 'estimate',
  kcal: 150,
  prot: 5,
  fat: 5,
  carb: 20,
  minerals: {},
};

/** Region → ordered provider chain (BUILD SPEC §5.2). */
function chainFor(providers: NutritionProvider[], region: Region): NutritionProvider[] {
  // Preserve construction order; the caller registers providers per the spec'd
  // chains (US → [Usda, OFF, ApiNinjas]; RU → [Skurikhin, OFF, ApiNinjas]).
  return providers.filter((p) => p.regions.includes(region));
}

function cacheKey(name: string, region: Region): string {
  return `${region}::${name.trim().toLowerCase()}`;
}

/** Tiny insertion-ordered LRU for `(name, region) → per100` (BUILD SPEC §5.2). */
class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

/**
 * Region-aware nutrition resolver. Runs an identified item through the region's
 * provider chain to get EXACT per-100g, scales to the estimated grams, and on a
 * full miss falls back to a coarse `estimate` (never presented as fact).
 *
 * The model's job ended at identification; every NUMBER here comes from a
 * provider or the estimate fallback — never the LLM (THE HONESTY RULE, §1/§4).
 */
export class Resolver {
  private readonly cache = new Lru<Per100>(500);

  constructor(private readonly providers: NutritionProvider[]) {}

  /** US uses the English name; RU uses the Russian name (BUILD SPEC §6). */
  private lookupName(item: IdentifiedItem, region: Region): string {
    const name = region === 'US' ? item.name_en : item.name_ru;
    return (name || item.name_en || item.name_ru).trim();
  }

  private async lookupPer100(name: string, region: Region): Promise<Per100> {
    const key = cacheKey(name, region);
    const cached = this.cache.get(key);
    if (cached) return cached;

    for (const provider of chainFor(this.providers, region)) {
      const hit = await provider.search(name, region).catch(() => null);
      if (hit) {
        const per100 = coercePer100(hit.per100);
        this.cache.set(key, per100);
        return per100;
      }
    }
    // Full miss: coarse estimate. Not cached — a later DB import may resolve it.
    return ESTIMATE_PER100;
  }

  async resolveItem(item: IdentifiedItem, region: Region): Promise<NutritionItem> {
    const grams = item.est_grams > 0 ? item.est_grams : 100;
    const per100 = await this.lookupPer100(this.lookupName(item, region), region);
    return {
      name_ru: item.name_ru,
      name_en: item.name_en,
      grams,
      grams_source: 'estimated',
      confidence: item.confidence,
      per100,
      scaled: scaleToGrams(per100, grams),
      approximate: true, // estimated grams → approximate until the user confirms
    };
  }
}
