import type { Minerals, Per100, Region } from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { rankByName, scoreToConfidence } from './scoring.js';

const NUTRITION_URL = 'https://api.api-ninjas.com/v1/nutrition';

interface NinjaItem {
  name?: string;
  calories?: number;
  protein_g?: number;
  fat_total_g?: number;
  carbohydrates_total_g?: number;
  sodium_mg?: number;
  potassium_mg?: number;
  serving_size_g?: number;
}

function toMineral(value: number | undefined, factor: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value * factor;
}

/**
 * API Ninjas nutrition (paid, optional text fallback — BUILD SPEC §2/§5.2).
 * Its numbers are per serving; we normalize to per-100g using `serving_size_g`.
 * Disabled (always-null) when no key is configured.
 */
export class ApiNinjasProvider implements NutritionProvider {
  readonly name = 'apininjas';
  readonly regions = ['RU', 'US'] as const;

  constructor(private readonly apiKey: string) {}

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    return (await this.searchMany(name, region))[0] ?? null;
  }

  /** Ranked candidates, best-first. API Ninjas may return several items per query. */
  async searchMany(name: string, _region: Region): Promise<ProviderResult[]> {
    if (!this.apiKey || name.trim().length === 0) return [];
    const url = new URL(NUTRITION_URL);
    url.searchParams.set('query', name);

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers: { 'X-Api-Key': this.apiKey } });
    } catch {
      return [];
    }
    if (!res.ok) return [];

    const data = (await res.json().catch(() => null)) as NinjaItem[] | null;
    const items = Array.isArray(data) ? data : [];

    const ranked = rankByName(
      name,
      items.map((it) => ({ value: it, name: it.name ?? '' })),
    );

    const out: ProviderResult[] = [];
    for (const c of ranked) {
      const item = c.value;
      const serving = typeof item.serving_size_g === 'number' && item.serving_size_g > 0 ? item.serving_size_g : 100;
      const factor = 100 / serving; // per-serving → per-100g
      const minerals: Minerals = {};
      const na = toMineral(item.sodium_mg, factor);
      const k = toMineral(item.potassium_mg, factor);
      if (na !== undefined) minerals.na = na;
      if (k !== undefined) minerals.k = k;

      const per100: Per100 = {
        source: 'apininjas',
        kcal: Math.round((item.calories ?? 0) * factor),
        prot: (item.protein_g ?? 0) * factor,
        fat: (item.fat_total_g ?? 0) * factor,
        carb: (item.carbohydrates_total_g ?? 0) * factor,
        minerals,
      };
      if (per100.kcal === 0 && per100.prot === 0) continue;
      out.push({ per100, name: item.name ?? name, confidence: scoreToConfidence(c.score) });
    }
    return out;
  }
}
