import type { Per100, Region } from '../types.js';
import { CURATED_RU } from './curatedRu.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { SKURIKHIN_TABLE } from './skurikhinData.js';
import type { SkurikhinEntry } from './skurikhinTypes.js';

/** Normalize a RU food name for matching: lowercase, ё→е, strip punctuation. */
export function normalizeRu(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface IndexEntry {
  key: string; // normalized name or alias
  entry: SkurikhinEntry;
}

/**
 * RU nutrition from the Skurikhin composition table (BUILD SPEC §6) — the RU
 * launch's data source. Looks up an EXACT per-100g (incl. minerals); the model
 * never supplies numbers. Matching: exact normalized name/alias first, then a
 * word-overlap fallback so "куриная грудка отварная" still finds "куриная
 * грудка". A miss returns null and the resolver chain moves on.
 */
export class SkurikhinProvider implements NutritionProvider {
  readonly name = 'skurikhin';
  readonly regions = ['RU'] as const;

  private readonly index: IndexEntry[];

  // The default RU table is the auto-generated USDA-SR import PLUS the
  // hand-curated common-foods rows (пончик, булочка, …) that the import lacks.
  constructor(table: SkurikhinEntry[] = [...SKURIKHIN_TABLE, ...CURATED_RU]) {
    this.index = [];
    for (const entry of table) {
      this.index.push({ key: normalizeRu(entry.name), entry });
      for (const alias of entry.aliases) {
        this.index.push({ key: normalizeRu(alias), entry });
      }
    }
  }

  private toResult(entry: SkurikhinEntry, confidence: number): ProviderResult {
    // Honest provenance: USDA-sourced rows say 'usda', curated rows 'skurikhin'.
    const per100: Per100 = { source: entry.source ?? 'skurikhin', ...entry.per100 };
    return { per100, confidence };
  }

  private lookup(name: string): ProviderResult | null {
    const q = normalizeRu(name);
    if (q.length === 0) return null;

    // 1) exact normalized match on a name or alias.
    const exact = this.index.find((i) => i.key === q);
    if (exact) return this.toResult(exact.entry, 0.95);

    // 2) the query contains a known key as a whole word (e.g. "жареное яйцо").
    const words = new Set(q.split(' '));
    let best: { entry: SkurikhinEntry; overlap: number } | null = null;
    for (const { key, entry } of this.index) {
      const keyWords = key.split(' ');
      const overlap = keyWords.filter((w) => words.has(w)).length;
      if (overlap === keyWords.length && (!best || overlap > best.overlap)) {
        best = { entry, overlap };
      }
    }
    if (best) return this.toResult(best.entry, 0.8);

    // 3) any single key word appears in the query (loosest).
    for (const { key, entry } of this.index) {
      if (key.split(' ').some((w) => w.length >= 4 && words.has(w))) {
        return this.toResult(entry, 0.65);
      }
    }
    return null;
  }

  async search(name: string, _region: Region): Promise<ProviderResult | null> {
    return this.lookup(name);
  }
}
