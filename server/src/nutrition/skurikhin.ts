import type { Per100, Region } from '../types.js';
import { CURATED_RU } from './curatedRu.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { phraseScore } from './ruSearch.js';
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
  keyWords: number;
  entry: SkurikhinEntry;
}

/**
 * Below this phrase relevance a row is noise, not a candidate. Just above the
 * 0.5 "half the query honoured" floor: a two-word query with one word matched
 * against a two-word key (e.g. «сыр легкий» → «сыр российский») scores exactly
 * 0.5 and is dropped, so a lone matched word no longer drags in generic rows;
 * legit partials («куриная грудка отварная» → «куриная грудка» ≈ 0.77, «борщ»
 * → «борщ с мясом» ≈ 0.8) and single-typo hits (0.6) stay well clear.
 */
const MIN_SCORE = 0.55;

/** Ranked candidates the manual picker gets from this table. */
const MAX_CANDIDATES = 5;

/**
 * RU nutrition from the Skurikhin composition table (BUILD SPEC §6) — the RU
 * launch's data source. Looks up an EXACT per-100g (incl. minerals); the model
 * never supplies numbers. Matching runs through `ruSearch` (stems, prefixes,
 * one-typo tolerance, relevance ranking), so «борща», «гречк» and «гретчка»
 * all still land on the right row. A miss returns null / an empty list and
 * the resolver chain moves on.
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
      for (const key of [entry.name, ...entry.aliases]) {
        const normalized = normalizeRu(key);
        if (normalized.length > 0) {
          this.index.push({ key: normalized, keyWords: normalized.split(' ').length, entry });
        }
      }
    }
  }

  private toResult(entry: SkurikhinEntry, confidence: number): ProviderResult {
    // Honest provenance: USDA-sourced rows say 'usda', curated rows 'skurikhin'.
    const per100: Per100 = { source: entry.source ?? 'skurikhin', ...entry.per100 };
    return { per100, confidence, name: entry.name, ...(entry.prepared ? { prepared: true } : {}) };
  }

  /**
   * All entries relevant to the query, best-first. Each entry keeps its best
   * score across name + aliases; ties prefer the shorter (more generic) key so
   * plain «борщ» outranks «борщ с мясом» on a plain «борщ» query.
   */
  private rank(name: string): { entry: SkurikhinEntry; score: number }[] {
    const q = normalizeRu(name);
    if (q.length === 0) return [];

    const best = new Map<SkurikhinEntry, { entry: SkurikhinEntry; score: number; keyWords: number }>();
    for (const { key, keyWords, entry } of this.index) {
      const score = phraseScore(q, key);
      if (score < MIN_SCORE) continue;
      const prev = best.get(entry);
      if (!prev || score > prev.score || (score === prev.score && keyWords < prev.keyWords)) {
        best.set(entry, { entry, score, keyWords });
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.keyWords - b.keyWords);
  }

  /** Exact hits read as near-certain; everything fuzzier scales with its score. */
  private confidenceOf(score: number): number {
    return score >= 0.999 ? 0.95 : Math.min(0.9, 0.45 + 0.5 * score);
  }

  async search(name: string, _region: Region): Promise<ProviderResult | null> {
    const top = this.rank(name)[0];
    return top ? this.toResult(top.entry, this.confidenceOf(top.score)) : null;
  }

  /** Ranked candidates for the manual "find it yourself" picker. */
  async searchMany(name: string, _region: Region): Promise<ProviderResult[]> {
    return this.rank(name)
      .slice(0, MAX_CANDIDATES)
      .map((r) => this.toResult(r.entry, this.confidenceOf(r.score)));
  }
}
