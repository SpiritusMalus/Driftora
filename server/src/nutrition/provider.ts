import type { Per100, Region } from '../types.js';

/**
 * A source could not be REACHED (network down, timeout, 5xx, revoked key) —
 * which is NOT the same as «this food isn't in the database», even though both
 * used to arrive as an empty list. Conflating them makes the app state a
 * falsehood: «нет в базе» about a food it never actually got to look up. Sources
 * throw this so the resolver can tell the two apart and the client can say the
 * true thing («база не ответила») instead.
 */
export class ProviderUnavailable extends Error {
  constructor(readonly provider: string, cause?: unknown) {
    super(`nutrition provider unavailable: ${provider}`);
    this.name = 'ProviderUnavailable';
    if (cause !== undefined) this.cause = cause;
  }
}

/** A per-100g lookup result from one source, with a 0..1 match confidence. */
export interface ProviderResult {
  per100: Per100;
  confidence: number;
  /** The matched candidate's display name (for the "не то?" alternatives UI). */
  name?: string;
  /**
   * The KEY that actually matched the query, when it differs from the display
   * name — an alias like «куриное филе» on the row «куриная грудка запечённая».
   * The resolver's coverage gate must measure against what FOUND the row:
   * measured against the display name alone, that row scored 0.33 on «куриное
   * филе отварное», was demoted to a weak fallback, and USDA's «в панировке»
   * won the walk at full confidence (owner report 2026-08-25) — the same
   * two-gates-measure-differently trap as the «огурцы»≠«огурец» bug.
   */
  matchedKey?: string;
  /**
   * The matched row describes a finished, ready-to-eat dish (curated-table
   * flag) — its per-100g is the dish as served, so cooking-method adjustments
   * on top would double-count. Only the curated RU table sets this.
   */
  prepared?: boolean;
  /**
   * How many logged confirmations stand behind the row. Only the SHARED base
   * (`community`) sets this — a composition table is not voted on. It rides to
   * the client on the alternatives the user picks between, which is where the
   * count actually changes a decision («записей: 12» vs «записей: 1»).
   */
  votes?: number;
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
  /**
   * Optional: this source can ALSO answer a raw Cyrillic free-text query even
   * though its preferred `queryLang` is 'en' (FatSecret localizes via its
   * `region`/`language` params). The manual-search path uses it to decide who
   * gets the user's Cyrillic text; the parse chain still queries by `queryLang`.
   */
  readonly acceptsCyrillic?: boolean;
  /**
   * Optional: this source can resolve a raw BARCODE (8–14 digits) as a query.
   * Only Open Food Facts and the local snapshot built from it can — a table of
   * food NAMES (USDA, Skurikhin, FatSecret) has nothing to match digits
   * against. It matters beyond wasted latency: such a provider failing on a
   * barcode used to raise `sourcesDown`, and the phone then said «источник не
   * ответил» about a code that simply is not in any database — inviting a retry
   * that could never succeed.
   */
  readonly acceptsBarcode?: boolean;
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
