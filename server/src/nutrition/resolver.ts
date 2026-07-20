import {
  coercePer100,
  scaleToGrams,
  type AiEstimate,
  type IdentifiedItem,
  type LabelReading,
  type Minerals,
  type NutritionAlternative,
  type NutritionItem,
  type Per100,
  type Region,
  type Vitamins,
} from '../types.js';
import type { FoodEstimate } from '../llm.js';
import { looksDryBasis } from './dryBasis.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { kcalBandViolated } from './plausibility.js';
import { hasCyrillic } from './ruSearch.js';
import { demoteContradictions, MIN_CHAIN_COVERAGE, queryCoverage } from './scoring.js';

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
  microsEstimated?: boolean; // vitamins/minerals were back-filled from a USDA proxy
  // No source explained even half the query's own words — every provider was
  // tried and this was merely the least-bad row. The caller prefers the model's
  // estimate over it (see the weak-match branch in `resolve`).
  weak?: boolean;
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

/** USDA search score below which its micros are too weak a match to graft. */
const MICRO_BACKFILL_MIN_CONFIDENCE = 0.4;

/**
 * Build a per-100g from the model's OWN estimate — only when it is complete
 * (kcal + all three macros). Used as the fallback for foods absent from every
 * DB, and as a switchable alternative when the referee flags a bad DB match.
 * Source `ai_estimate`: honestly attributed, counted, but flagged.
 */
function aiEstimatePer100(est: AiEstimate): Per100 | null {
  const { kcal_100g, prot_100g, fat_100g, carb_100g } = est;
  if (kcal_100g === undefined || prot_100g === undefined || fat_100g === undefined || carb_100g === undefined) {
    return null;
  }
  return coercePer100({ source: 'ai_estimate', kcal: kcal_100g, prot: prot_100g, fat: fat_100g, carb: carb_100g });
}

/**
 * REFEREE: does a DB match's composition contradict the model's expectation for
 * the SAME food badly enough to suspect a wrong-food match (skyr → «яблоко»)?
 * Conservative on purpose — flags only a gross divergence (both a large ratio
 * AND a large absolute gap), so normal recipe variation never trips it. Works
 * on whichever estimate fields are present (a protein-only estimate still helps).
 */
function estimateMismatch(db: Per100, est: AiEstimate): boolean {
  const grossly = (a: number, b: number, ratio: number, absGap: number): boolean => {
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    return hi >= ratio * Math.max(lo, 0.5) && hi - lo > absGap;
  };
  if (est.kcal_100g !== undefined && est.kcal_100g > 0 && grossly(db.kcal, est.kcal_100g, 2, 40)) return true;
  // Protein is the most diagnostic macro for a swapped food (skyr 11 vs apple 0.3).
  if (est.prot_100g !== undefined && est.prot_100g > 0 && grossly(db.prot, est.prot_100g, 2.5, 8)) return true;
  return false;
}

/** Numeric grade tokens in a food name (incl. decimals, «,»→«.») — «молоко 1.8%» → ['1.8']. */
function gradesOf(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace(',', '.'));
}

/**
 * The user asked for a specific GRADE the matched row doesn't actually carry —
 * «молоко 1.8%» resolved to «молоко 1%», «сыр 30%» to a plain «сыр». The stray
 * grade proves the DB lacks that exact variant, so we should offer the model's
 * estimate for the real grade rather than pass off the wrong one as a hit.
 */
function unhonoredGrade(query: string, matched?: string): boolean {
  if (!matched) return false;
  const wanted = gradesOf(query);
  if (wanted.length === 0) return false;
  const have = new Set(gradesOf(matched));
  return wanted.some((g) => !have.has(g));
}

/** Confidence a DB match is knocked down to once the referee flags it. */
const REFEREE_DEMOTED_CONFIDENCE = 0.3;

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
  /** USDA provider, if present — the only source that carries vitamins, so it's
   *  also the donor for micronutrient back-fill onto curated-RU / OFF matches. */
  private readonly usda?: NutritionProvider;

  /**
   * Fills a DB miss with a per-100g guess for a FOOD NAME — a short, text-only
   * model call. Injected rather than imported so the resolver stays testable
   * without a network, and optional so a caller can run fully offline.
   *
   * This exists because the PHOTO path no longer asks the vision model for
   * nutrition numbers (see IDENTIFY_PHOTO_SYSTEM_PROMPT): the numeric fields
   * were where its decode loop lived. The estimate still happens — just in its
   * own cheap call, over a name instead of an image, where a failure costs one
   * row rather than the whole photo.
   */
  private readonly estimator?: (name: string, region: Region) => Promise<FoodEstimate | null>;

  constructor(
    private readonly providers: NutritionProvider[],
    estimator?: (name: string, region: Region) => Promise<FoodEstimate | null>,
  ) {
    this.usda = providers.find((p) => p.name === 'usda');
    this.estimator = estimator;
  }

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

  /**
   * Walk the region chain, querying each provider by its own name choice.
   *
   * A hit only STOPS the chain when it actually explains the query (see
   * [MIN_CHAIN_COVERAGE]). Thin hits are remembered and the walk continues, so a
   * weak early source can no longer shut out a better later one: USDA sits second
   * in the RU chain, and its one-token «tarragon» match on «лимонад тархун
   * черноголовка» used to return before Open Food Facts — where the branded drink
   * actually lives — was ever asked. If nothing stronger turns up, the best thin
   * hit comes back flagged `weak` so the caller can prefer the model's estimate.
   */
  private async runChain(region: Region, nameFor: (p: NutritionProvider) => string): Promise<LookupResult | null> {
    let weakFallback: LookupResult | null = null;
    for (const provider of chainFor(this.providers, region)) {
      const name = nameFor(provider);
      if (name.length === 0) continue;
      // Drop zero-confidence rows (no name overlap at all) BEFORE picking a
      // primary: a broad free-text provider that returns off-topic junk (milk
      // rows for a salad query) must not stop the chain or beat the estimate.
      const candidates = (await this.candidatesFrom(provider, name, region)).filter((c) => c.confidence > 0);
      // Name ranking alone can pick a product the query explicitly negated
      // («без сахара» → sugared row); composition-aware demotion fixes the
      // order and honestly drops confidence when only contradictions exist.
      const results = demoteContradictions(name, candidates);
      const primary = results[0];
      if (!primary) continue;
      const hit: LookupResult = {
        per100: coercePer100(primary.per100),
        matchConfidence: clamp01(primary.confidence),
        name: primary.name,
        ...(primary.prepared === true ? { prepared: true } : {}),
        alternatives: results.slice(1, 1 + MAX_ALTERNATIVES).map((r) => ({
          name: r.name ?? name,
          per100: coercePer100(r.per100),
        })),
      };
      if (queryCoverage(name, primary.name ?? name) < MIN_CHAIN_COVERAGE) {
        // Keep the FIRST thin hit: the chain is ordered by trustworthiness, so an
        // early source's weak row still beats a later source's weak row.
        if (!weakFallback) weakFallback = { ...hit, weak: true };
        continue;
      }
      return hit;
    }
    return weakFallback;
  }

  /** Item lookup: providers may be queried by name_ru or name_en (queryLang). */
  private async lookupItem(item: IdentifiedItem, region: Region): Promise<LookupResult> {
    const key = cacheKey(`${item.name_ru}|${item.name_en}`, region);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const found = await this.runChain(region, (p) => this.nameFor(p, item, region));
    if (found) {
      const enriched = await this.backfillMicros(found, item.name_en);
      this.cache.set(key, enriched);
      return enriched;
    }
    return { per100: ESTIMATE_PER100, matchConfidence: 0, alternatives: [] };
  }

  /**
   * Graft vitamins (and any missing minerals) from a generic USDA record onto a
   * match whose source carries none — curated RU dishes (борщ, каша: `skurikhin`
   * wins the chain before USDA is ever queried) and crowd OFF products (vitamins
   * absent by construction). The primary's OWN minerals stay authoritative; USDA
   * only fills the gaps. Result is flagged `microsEstimated` so the client can
   * say the micros are an approximate proxy, not the exact product's values.
   *
   * No-op when the match already has vitamins, is a bare estimate, or is itself
   * from USDA — and cached inside the LookupResult, so a hit pays no extra call.
   */
  private async backfillMicros(found: LookupResult, nameEn: string): Promise<LookupResult> {
    const per100 = found.per100;
    if (!this.usda || per100.source === 'usda' || per100.source === 'estimate') return found;
    if (per100.vitamins) return found; // already carries the richer micro set
    if (nameEn.trim().length === 0) return found;

    const donor = await this.usdaMicros(nameEn);
    if (!donor) return found;

    const minerals: Minerals = { ...donor.minerals, ...per100.minerals }; // primary wins on overlap
    const merged: Per100 = { ...per100, minerals };
    if (donor.vitamins) merged.vitamins = donor.vitamins;
    return { ...found, per100: merged, microsEstimated: true };
  }

  /** Top USDA candidate's micro block for `nameEn`, or null if none is a good
   *  enough match / it carries no micronutrients worth grafting. */
  private async usdaMicros(nameEn: string): Promise<{ minerals: Minerals; vitamins?: Vitamins } | null> {
    if (!this.usda) return null;
    // USDA is English-only; the resolver queries it with name_en in every region.
    const [top] = await this.candidatesFrom(this.usda, nameEn, 'US');
    if (!top || clamp01(top.confidence) < MICRO_BACKFILL_MIN_CONFIDENCE) return null;
    const p = coercePer100(top.per100);
    const hasMinerals = Object.keys(p.minerals).length > 0;
    if (!p.vitamins && !hasMinerals) return null;
    return { minerals: p.minerals, ...(p.vitamins ? { vitamins: p.vitamins } : {}) };
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
    const merged = demoteContradictions(trimmed, lists.flat().filter((c) => c.confidence > 0));
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
    let aiFull = item.estimate ? aiEstimatePer100(item.estimate) : null;
    const prepared = found.prepared === true || item.prepared === true;
    // DB MISS → fall back to the model's own estimate (source 'ai_estimate',
    // counted but flagged) if it's complete; else ask the text-only estimator
    // for one (the photo path carries no `estimate` of its own); else the
    // coarse placeholder.
    if (found.matchConfidence === 0) {
      let filled = aiFull;
      if (!filled && this.estimator) {
        try {
          const est = await this.estimator(this.nativeName(item, region), region);
          if (est) {
            filled = coercePer100({
              source: 'ai_estimate',
              kcal: est.kcal,
              prot: est.prot,
              fat: est.fat,
              carb: est.carb,
            });
          }
        } catch {
          // Best-effort: a failed estimate just leaves the coarse placeholder.
        }
      }
      if (filled) {
        return {
          name_ru: item.name_ru,
          name_en: item.name_en,
          grams,
          grams_source: 'estimated',
          confidence: item.confidence,
          per100: filled,
          scaled: scaleToGrams(filled, grams),
          approximate: true,
          ...(prepared ? { prepared: true } : {}),
        };
      }
      if (aiFull) {
        return {
          name_ru: item.name_ru,
          name_en: item.name_en,
          grams,
          grams_source: 'estimated',
          confidence: item.confidence,
          per100: aiFull,
          scaled: scaleToGrams(aiFull, grams),
          approximate: true,
          ...(prepared ? { prepared: true } : {}),
        };
      }
      return {
        name_ru: item.name_ru,
        name_en: item.name_en,
        grams,
        grams_source: 'estimated',
        confidence: item.confidence,
        per100: found.per100, // ESTIMATE_PER100 placeholder
        scaled: scaleToGrams(found.per100, grams),
        approximate: true,
        ...(prepared ? { prepared: true } : {}),
      };
    }

    // A dry-product label matched against a likely-cooked weight overcounts ~3× —
    // flag it (never silently "correct" it). Suppressed for prepared dishes: the
    // curated finished-dish row already describes the cooked state.
    const dryBasis = !prepared && looksDryBasis([item.name_ru, item.name_en, found.name], found.per100);

    const graded = /\d/.test(item.name_ru);
    // The model's own estimate is the REFEREE that catches a confidently wrong
    // DB row (see the weak-match and mismatch branches below). Photo items no
    // longer carry one — the numeric fields were where the vision model's decode
    // loop lived — so a thin match had nothing to be checked against and passed
    // as fact: «Бабаевский» settled on a 329 kcal USDA row for a ~490 kcal bar.
    // Fetch the band on demand, but ONLY for matches already under suspicion, so
    // a clean five-component plate still costs zero extra calls.
    let refereeEstimate: AiEstimate | undefined = item.estimate;
    // Grade unhonored at HIGH confidence («творог 5%» → a 0.95 hit on «творог
    // 2%») also needs the band: the text path no longer ships an estimate, so
    // without this fetch the wrong-grade branch below would starve and the
    // mislabelled row would pass as a clean hit.
    const gradeMiss = graded && unhonoredGrade(item.name_ru, found.name);
    // Zero-latency referee: a CONFIDENT row whose kcal is impossible for the
    // food's class («кабачки» at 306/100 g) — the one error a name match can't
    // see and the LLM referee never inspects. Treated exactly like a weak match.
    const bandViolated = found.matchConfidence > 0 && kcalBandViolated(item.name_ru, item.name_en, found.per100.kcal);
    if (!aiFull && this.estimator && (found.weak || gradeMiss || bandViolated || (graded && found.matchConfidence < 0.9))) {
      try {
        const est = await this.estimator(this.nativeName(item, region), region);
        if (est) {
          refereeEstimate = {
            kcal_100g: est.kcal,
            prot_100g: est.prot,
            fat_100g: est.fat,
            carb_100g: est.carb,
          };
          aiFull = aiEstimatePer100(refereeEstimate);
        }
      } catch {
        // Best-effort: without a band the row simply stays unrefereed, as before.
      }
    }

    // WRONG GRADE → AI ESTIMATE IS PRIMARY. The user named a specific grade
    // (молоко 1.8%) but the DB only has a DIFFERENT one (молоко 3.2%) — defaulting
    // to the wrong-grade number reads as «почему 3.2%?». The model's estimate IS
    // the requested grade, so make IT the primary (honestly flagged «≈ оценка ИИ»)
    // and keep the real-but-wrong-grade DB row as a one-tap alternative below.
    if (graded && aiFull && unhonoredGrade(item.name_ru, found.name)) {
      return {
        name_ru: item.name_ru,
        name_en: item.name_en,
        grams,
        grams_source: 'estimated',
        confidence: item.confidence,
        per100: aiFull,
        scaled: scaleToGrams(aiFull, grams),
        approximate: true,
        ...(prepared ? { prepared: true } : {}),
        alternatives: [{ name: found.name ?? item.name_ru, per100: found.per100 }, ...found.alternatives].slice(
          0,
          MAX_ALTERNATIVES,
        ),
      };
    }

    // WEAK MATCH → AI ESTIMATE IS PRIMARY. Every source was tried and none
    // explained even half the query's own words; this row is just the least-bad
    // one. For a branded or regional product that is the normal outcome (the DB
    // simply doesn't carry «лимонад тархун черноголовка»), and a confidently
    // wrong row is far worse than an honest ≈: the herb match said 974 kcal and
    // 75 g protein for a 330 ml bottle whose real figure is ~66 kcal. The model's
    // class-level estimate is primary; the thin row stays a one-tap alternative.
    if ((found.weak || bandViolated) && aiFull) {
      return {
        name_ru: item.name_ru,
        name_en: item.name_en,
        grams,
        grams_source: 'estimated',
        confidence: item.confidence,
        per100: aiFull,
        scaled: scaleToGrams(aiFull, grams),
        approximate: true,
        ...(prepared ? { prepared: true } : {}),
        alternatives: [{ name: found.name ?? item.name_ru, per100: found.per100 }, ...found.alternatives].slice(
          0,
          MAX_ALTERNATIVES,
        ),
      };
    }

    // DB HIT → the DB is authoritative, but the REFEREE cross-checks it against
    // the model's expectation. A gross divergence (skyr's protein 0.3 vs ~11)
    // means the match is probably the wrong food: keep the DB number primary but
    // drop confidence (client surfaces the picker) and offer the AI estimate as
    // a one-tap alternative. We never let the model silently overwrite the DB.
    // GRADE CHECK (grade HONORED but loose): a graded query that landed on a
    // crowd hit (<0.9) — offer the model's clean estimate as an alternative too.
    const gradeSuspect = !!aiFull && graded && found.matchConfidence < 0.9;
    // A thin match with NO estimate to fall back on still can't pass as fact —
    // demote it so the client opens the picker instead of reading it as a hit.
    const suspect =
      (aiFull && refereeEstimate ? estimateMismatch(found.per100, refereeEstimate) : false) ||
      gradeSuspect ||
      bandViolated ||
      !!found.weak;
    const confidence = suspect
      ? REFEREE_DEMOTED_CONFIDENCE
      : Math.min(item.confidence, found.matchConfidence);
    const alternatives: NutritionAlternative[] =
      suspect && aiFull ? [{ name: item.name_ru, per100: aiFull }, ...found.alternatives] : found.alternatives;

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
      ...(dryBasis ? { dry_basis: true } : {}),
      ...(found.microsEstimated ? { micros_estimated: true } : {}),
      ...(alternatives.length > 0 ? { alternatives: alternatives.slice(0, MAX_ALTERNATIVES) } : {}),
    };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
