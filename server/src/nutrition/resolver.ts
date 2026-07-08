import {
  coercePer100,
  scaleToGrams,
  type IdentifiedItem,
  type LabelReading,
  type NutritionAlternative,
  type NutritionItem,
  type Per100,
  type Region,
} from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { hasCyrillic } from './ruSearch.js';
import { demoteContradictions } from './scoring.js';

/** How many runner-up matches to carry as switchable alternatives. */
const MAX_ALTERNATIVES = 4;

/** Manual search: total candidates across ALL merged providers. */
const MAX_SEARCH_RESULTS = 8;

/** The primary match plus its ranked runners-up and the match confidence. */
interface LookupResult {
  per100: Per100;
  matchConfidence: number; // 0..1; 0 on a full miss (estimate)
  name?: string; // primary candidate's display name (for manual search results)
  prepared?: boolean; // primary match is a finished dish (curated-table flag)
  alternatives: NutritionAlternative[];
}

/**
 * Build an EXACT per-100g straight from a photographed nutrition panel — but
 * ONLY when the panel is complete (kcal + all three macros legible). A partial
 * front-of-pack callout (e.g. protein + fat only) would splice into a DB row
 * and produce a Frankenstein composition, so we don't: incomplete labels fall
 * through to the normal name-based lookup, and `net_weight_g` still helps grams.
 * Returns null when the label can't stand on its own.
 */
function labelPer100(label: LabelReading): Per100 | null {
  const { kcal_100g, prot_100g, fat_100g, carb_100g } = label;
  if (
    kcal_100g === undefined ||
    prot_100g === undefined ||
    fat_100g === undefined ||
    carb_100g === undefined
  ) {
    return null;
  }
  // coercePer100 clamps/normalizes and stamps the 'label' source.
  return coercePer100({
    source: 'label',
    kcal: kcal_100g,
    prot: prot_100g,
    fat: fat_100g,
    carb: carb_100g,
  });
}

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
  private readonly cache = new Lru<LookupResult>(500);
  private readonly searchCache = new Lru<NutritionAlternative[]>(300);

  constructor(private readonly providers: NutritionProvider[]) {}

  /** US uses the English name; RU uses the Russian name (BUILD SPEC §6). */
  private nativeName(item: IdentifiedItem, region: Region): string {
    const name = region === 'US' ? item.name_en : item.name_ru;
    return (name || item.name_en || item.name_ru).trim();
  }

  /**
   * The name a given provider is queried with: its declared `queryLang` wins
   * (an English-only source gets `name_en` even in the RU chain — this is what
   * lets USDA serve as the broad RU fallback), else the region-native name.
   */
  private nameFor(provider: NutritionProvider, item: IdentifiedItem, region: Region): string {
    const native = this.nativeName(item, region);
    if (provider.queryLang === 'en') return (item.name_en || native).trim();
    if (provider.queryLang === 'ru') return (item.name_ru || native).trim();
    return native;
  }

  /** A provider's ranked candidates, preferring `searchMany` over single `search`. */
  private async candidatesFrom(provider: NutritionProvider, name: string, region: Region): Promise<ProviderResult[]> {
    if (provider.searchMany) return provider.searchMany(name, region).catch(() => []);
    const one = await provider.search(name, region).catch(() => null);
    return one ? [one] : [];
  }

  /** Walk the region chain, querying each provider by its own name choice. */
  private async runChain(region: Region, nameFor: (p: NutritionProvider) => string): Promise<LookupResult | null> {
    for (const provider of chainFor(this.providers, region)) {
      const name = nameFor(provider);
      if (name.length === 0) continue;
      // Name ranking alone can pick a product the query explicitly negated
      // («без сахара» → sugared row); composition-aware demotion fixes the
      // order and honestly drops confidence when only contradictions exist.
      const results = demoteContradictions(name, await this.candidatesFrom(provider, name, region));
      const primary = results[0];
      if (primary) {
        return {
          per100: coercePer100(primary.per100),
          matchConfidence: clamp01(primary.confidence),
          name: primary.name,
          ...(primary.prepared === true ? { prepared: true } : {}),
          alternatives: results.slice(1, 1 + MAX_ALTERNATIVES).map((r) => ({
            name: r.name ?? name,
            per100: coercePer100(r.per100),
          })),
        };
      }
    }
    return null;
  }

  /** Item lookup: providers may be queried by name_ru or name_en (queryLang). */
  private async lookupItem(item: IdentifiedItem, region: Region): Promise<LookupResult> {
    const key = cacheKey(`${item.name_ru}|${item.name_en}`, region);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const found = await this.runChain(region, (p) => this.nameFor(p, item, region));
    if (found) {
      this.cache.set(key, found);
      return found;
    }
    return { per100: ESTIMATE_PER100, matchConfidence: 0, alternatives: [] };
  }

  /**
   * Free-text DB search for the manual "find it yourself" picker (disambiguation
   * layer 4). Unlike the parse path's first-hit-wins chain, this queries EVERY
   * region provider in parallel and merges in chain order (curated table first,
   * then the broad DBs, then crowd brands) — a loose curated hit no longer
   * hides the branded products, and each row carries an EXACT per-100g with its
   * source. Empty on a full miss.
   */
  async search(name: string, region: Region): Promise<NutritionAlternative[]> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return [];
    const key = cacheKey(trimmed, region);
    const cached = this.searchCache.get(key);
    if (cached) return cached;

    // An English-only corpus (USDA) cannot match Cyrillic text — skip the
    // round-trip instead of paying its latency for guaranteed zero results.
    const cyrillic = hasCyrillic(trimmed);
    const lists = await Promise.all(
      chainFor(this.providers, region).map((p) =>
        cyrillic && p.queryLang === 'en' ? Promise.resolve([]) : this.candidatesFrom(p, trimmed, region),
      ),
    );
    const merged = demoteContradictions(trimmed, lists.flat());
    const out = merged.slice(0, MAX_SEARCH_RESULTS).map((r) => ({
      name: r.name ?? trimmed,
      per100: coercePer100(r.per100),
    }));
    // Misses stay uncached — a later DB import may resolve them.
    if (out.length > 0) this.searchCache.set(key, out);
    return out;
  }

  async resolveItem(item: IdentifiedItem, region: Region): Promise<NutritionItem> {
    // Net weight read off the package (масса нетто) beats a portion guess for
    // the eaten grams — used whether or not the panel itself was complete.
    const labelWeight = item.label?.net_weight_g;
    const estGrams = item.est_grams > 0 ? item.est_grams : 100;

    // A complete panel photographed off the package IS the exact composition —
    // skip the name-based DB lookup entirely and trust the printed numbers.
    const panel = item.label ? labelPer100(item.label) : null;
    if (panel) {
      const grams = labelWeight ?? estGrams;
      return {
        name_ru: item.name_ru,
        name_en: item.name_en,
        grams,
        grams_source: 'estimated', // user still confirms/edits the eaten amount
        confidence: item.confidence, // label is ground truth; keep identity's confidence
        per100: panel,
        scaled: scaleToGrams(panel, grams),
        approximate: true,
        // No matched_name / alternatives: the numbers came from the package,
        // not a DB row. The 'label' source tells the client to show «по упаковке».
        ...(item.prepared === true ? { prepared: true } : {}),
      };
    }

    const grams = labelWeight ?? estGrams;
    const found = await this.lookupItem(item, region);
    // A weak DB match should drag the item's confidence down (so the client
    // flags it + shows the picker), but never inflate it past identification.
    const confidence = found.matchConfidence > 0 ? Math.min(item.confidence, found.matchConfidence) : item.confidence;
    // Finished dish = the curated row says so OR identification did. Either
    // signal alone suffices (a false positive just hides the coarse cook
    // adjustment); absence of both sends nothing.
    const prepared = found.prepared === true || item.prepared === true;
    return {
      name_ru: item.name_ru,
      name_en: item.name_en,
      grams,
      grams_source: 'estimated',
      confidence,
      per100: found.per100,
      scaled: scaleToGrams(found.per100, grams),
      approximate: true, // estimated grams → approximate until the user confirms
      // Transparency: tell the client WHICH row was matched, not just its
      // numbers — the row's own name usually carries the preparation state.
      ...(found.name ? { matched_name: found.name } : {}),
      ...(prepared ? { prepared: true } : {}),
      ...(found.alternatives.length > 0 ? { alternatives: found.alternatives } : {}),
    };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
