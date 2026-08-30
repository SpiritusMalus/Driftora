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
import { cookedFromDry, dryFromCooked, dryStarchYield, rowBasis, weighedDry, type Basis } from './dryBasis.js';
import { energyFromMacros, energyInconsistent } from './energy.js';
import { isBarcode } from './openfoodfacts.js';
import { ProviderUnavailable, type NutritionProvider, type ProviderResult } from './provider.js';
import { kcalBandViolated } from './plausibility.js';
import { hasCyrillic } from './ruSearch.js';
import {
  contradictsQuery,
  demoteContradictions,
  headNounLost,
  introducesForeignForm,
  MIN_CHAIN_COVERAGE,
  queryCoverage,
} from './scoring.js';
import { translationLost, unexplainedSpecifics } from './specificity.js';

/**
 * Manual-search result. `sourcesDown` separates «looked everywhere, this food
 * isn't there» from «a source never answered» — the difference between an
 * honest empty state and a claim we have no right to make.
 */
export interface SearchOutcome {
  candidates: NutritionAlternative[];
  sourcesDown: boolean;
}

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
  // The row covers the FOOD but not the SPECIFIC product asked for: a brand or
  // variety («мистраль», «черноголовка») that no source explained. Unlike
  // `weak` the numbers are a real row for the right food class, so it stays
  // primary — but demoted, with the picker opened and an AI estimate offered.
  qualifierUnmatched?: boolean;
  // A source was unreachable while this answer was assembled — so it may be
  // WORSE than what the same query deserves. Transient bookkeeping, never sent
  // to the client: its only job is to keep the outage out of the cache.
  degraded?: boolean;
  // Rows OTHER sources returned for the SAME query during this walk, good
  // enough to stand as a micronutrient donor. Transient bookkeeping: the walk
  // has already paid for them, so a gap can be filled without a sixth request —
  // and, unlike the USDA fallback, they were found in the language the food was
  // actually named in. See [backfillMicros].
  donors?: Per100[];
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
    // Cross-checked «пищевые волокна» when the panel printed them — rides into
    // the day's fiber total instead of silently reading as absent.
    ...(label.fiber_100g !== undefined ? { fiber: label.fiber_100g } : {}),
  });
}

/** USDA search score below which its micros are too weak a match to graft. */
const MICRO_BACKFILL_MIN_CONFIDENCE = 0.4;

/**
 * «Масса нетто» counts as the EATEN grams only up to this size. Single-serve
 * packs (bars 20–100 g, yogurt cups 120–350 g, a 330–500 ml drink) are
 * genuinely finished in one sitting; a family pack or a litre bottle is not,
 * and defaulting grams to ITS net weight silently logged the whole package.
 * Above the cap the per-100g numbers still come from the label — only the
 * eaten-amount default falls back to the visible-portion estimate.
 */
const NET_WEIGHT_AS_EATEN_MAX_G = 500;

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
  // Keep the model's kcal when it already reconciles with its own macros — it may
  // encode specific-Atwater/measured knowledge the general formula lacks (dairy
  // fat 8.79 not 9, etc.), and that few-percent spread lives inside the «≈» band
  // anyway. Only when the two GROSSLY contradict — a transposed fat↔carb, or a
  // per-serving kcal left against per-100g macros — fall back to the macro-derived
  // value, so the card can never show a kcal that visibly doesn't match the P/F/C
  // beside it. (docs/nutrition-science.md §1; the client, not the LLM, owns the
  // arithmetic when they disagree.)
  const macros = { prot: prot_100g, fat: fat_100g, carb: carb_100g };
  const kcal = energyInconsistent({ kcal: kcal_100g, ...macros }) ? energyFromMacros(macros) : kcal_100g;
  return coercePer100({ source: 'ai_estimate', kcal, ...macros });
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

/**
 * Numeric GRADE tokens in a food name — «молоко 1.8%» → ['1.8']. A grade is a
 * number with «%» (жирность, сорт) or a decimal («молоко 3,2» — голос часто
 * опускает знак процента). A bare integer is NOT a grade: «хлеб 7 злаков» и
 * «3 сыра» называют продукт, и строка «хлеб зерновой» без семёрки — не «не тот
 * сорт», а нормальный ответ; считая любую цифру сортом, мы ставили ИИ-оценку
 * поверх верной строки (аудит 2026-08-26).
 */
function gradesOf(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)?\s*%|\d+[.,]\d+/g) ?? []).map((x) =>
    x.replace(',', '.').replace(/\s*%$/, ''),
  );
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

  /** Told about every unreachable source, so an outage is a number rather than
   *  a silently worse answer. Optional — tests and offline runs pass nothing. */
  private readonly onSourceUnavailable?: (source: string, reason: string) => void;

  constructor(
    private readonly providers: NutritionProvider[],
    estimator?: (name: string, region: Region) => Promise<FoodEstimate | null>,
    onSourceUnavailable?: (source: string, reason: string) => void,
  ) {
    this.usda = providers.find((p) => p.name === 'usda');
    this.estimator = estimator;
    this.onSourceUnavailable = onSourceUnavailable;
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

  /**
   * A provider's ranked candidates, preferring `searchMany` over single `search`.
   * A source that could not be REACHED reports so via `unavailable` — an empty
   * list then means «looked, found nothing», which is a different sentence.
   */
  private async candidatesFrom(
    provider: NutritionProvider,
    name: string,
    region: Region,
  ): Promise<{ results: ProviderResult[]; unavailable: boolean }> {
    try {
      if (provider.searchMany) return { results: await provider.searchMany(name, region), unavailable: false };
      const one = await provider.search(name, region);
      return { results: one ? [one] : [], unavailable: false };
    } catch (err) {
      const unavailable = err instanceof ProviderUnavailable;
      if (unavailable) this.onSourceUnavailable?.(provider.name, (err as ProviderUnavailable).reason());
      return { results: [], unavailable };
    }
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
   *
   * The SAME must hold one level up, for the specific PRODUCT and not just the
   * food: a hit that leaves a brand or variety unexplained no longer stops the
   * walk either (`specificity.ts`). That is the hole the coverage gate cannot
   * see — an English-queried source is checked against OUR OWN translation, and
   * the brand died inside it, so «отруби овсяные мистраль» settled on a generic
   * 246 kcal row at 0.95 confidence before Open Food Facts (which carries the
   * actual «Овсяные отруби Мистраль») was ever asked, and offered bagels and
   * bran bread as the alternatives (owner report, 2026-08-22). Now the walk
   * continues; a source that DOES explain the brand wins outright, and when
   * none does, the generic row comes back flagged `qualifierUnmatched` — still
   * primary (it is a real row for the right food), but demoted so the client
   * opens the picker and the model's estimate rides along as an alternative.
   */
  private async runChain(
    region: Region,
    nameFor: (p: NutritionProvider) => string,
    userQuery: string,
  ): Promise<LookupResult | null> {
    let weakFallback: LookupResult | null = null;
    let genericFallback: LookupResult | null = null;
    let degraded = false;
    // ДОНОРЫ СОБИРАЮТСЯ ПО ДОРОГЕ. Каждый опрошенный источник уже ответил на
    // ЭТОТ ЖЕ запрос и на ТОМ ЖЕ языке — если он несёт клетчатку или витамины,
    // которых нет у победителя, это лучший донор, какой у нас может быть, и он
    // уже оплачен. Раньше донора искали ровно в одном месте — в USDA по
    // name_en, — и «тарелка овощей» уходила без клетчатки: наш собственный
    // перевод «fresh vegetables» не набирал порога, хотя RU-таблица, спрошенная
    // на первом же шаге, клетчатку несла.
    const donors: Per100[] = [];
    for (const provider of chainFor(this.providers, region)) {
      const name = nameFor(provider);
      if (name.length === 0) continue;
      // Drop zero-confidence rows (no name overlap at all) BEFORE picking a
      // primary: a broad free-text provider that returns off-topic junk (milk
      // rows for a salad query) must not stop the chain or beat the estimate.
      const answered = await this.candidatesFrom(provider, name, region);
      if (answered.unavailable) degraded = true;
      const candidates = answered.results.filter((c) => c.confidence > 0);
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
          // Only the shared base sets it; on every other source it stays absent.
          ...(r.votes === undefined ? {} : { votes: r.votes }),
        })),
      };
      // Донор — это тот же объект, что и per100 хита: победитель исключается
      // по тождеству, а не по эвристике «похоже, это он».
      if (clamp01(primary.confidence) >= MICRO_BACKFILL_MIN_CONFIDENCE) donors.push(hit.per100);
      // Coverage is measured against the BEST of what the source displays and
      // what actually MATCHED: the row «куриная грудка запечённая» is found by
      // its alias «куриное филе», and judged by the display name alone it
      // covered «куриное филе отварное» at 0.33 — demoted to a weak fallback,
      // while USDA's «в панировке» row went on to win the walk at full
      // confidence (owner report 2026-08-25). The gate must measure by the same
      // rule that found the row, or a match gets found and then thrown away.
      const shownName = primary.name ?? name;
      const coverageByName = queryCoverage(name, shownName);
      const coverageByKey = primary.matchedKey === undefined ? -1 : queryCoverage(name, primary.matchedKey);
      const coverage = Math.max(coverageByName, Math.max(coverageByKey, 0));
      // ЧТО ИМЕННО ОПРАВДАЛО МАТЧ — по этому виду и судим ниже. Строку могли
      // найти по алиасу, и тогда спрашивать «а объясняет ли запрос ПОКАЗЫВАЕМОЕ
      // имя» бессмысленно: оно матч не оправдывало.
      const justifiedBy = coverageByKey > coverageByName ? (primary.matchedKey as string) : shownName;
      // ГЛАВНОЕ СЛОВО ПОТЕРЯНО — тонко даже при проходном покрытии. «cereal bun»
      // против строки «cereal» даёт ровно 0.5 и раньше ОСТАНАВЛИВАЛО обход:
      // булочка приезжала хлопьями, с чужими числами и правильным именем.
      // Доля тут не помощник — «борщ украинский» → «борщ» тоже 0.5, но там
      // уцелело главное слово и еда та же. Различает их только то, ЧТО совпало.
      // Судим ТУ сторону, что оправдала матч. Раньше здесь стояло «и» по обоим
      // видам, и это пропускало главный случай: `headNounLost` отвечает «нет»
      // не только когда главное слово на месте, но и когда ей нечего сказать —
      // совпадения нет вовсе. Показываемое имя «гречка варёная» запрос
      // «гречневая лапша» не объясняет НИКАК, функция молчала, «и» читало это
      // молчание как «всё в порядке» — а матч тем временем держался на алиасе
      // «гречневая», то есть на голом определении. Лапша так и оставалась кашей.
      const headLost = headNounLost(name, justifiedBy);
      // ЧУЖАЯ ФОРМА. Зеркало предыдущей проверки: там строка теряла главное
      // слово запроса, здесь — добавляет своё, превращая еду в другой продукт.
      // «oatmeal cooked» садилось на «Oatmeal Raisin Soft Cooked Cookies»: все
      // слова запроса на месте, покрытие полное, еда — печенье.
      const foreignForm = introducesForeignForm(userQuery, shownName) && introducesForeignForm(name, shownName);
      if (coverage < MIN_CHAIN_COVERAGE || headLost || foreignForm) {
        // Keep the FIRST thin hit: the chain is ordered by trustworthiness, so an
        // early source's weak row still beats a later source's weak row.
        if (!weakFallback) weakFallback = { ...hit, weak: true };
        continue;
      }
      // A primary that CONTRADICTS the query (breaded on an «отварное» query,
      // sugared on «без сахара» — its confidence already capped to 0.4 by
      // demoteContradictions) must not stop the walk either: a later source may
      // carry the food as actually asked. Kept as the honest fallback if none does.
      if (contradictsQuery(name, primary)) {
        if (!genericFallback) genericFallback = { ...hit, qualifierUnmatched: true };
        continue;
      }
      // Did this row explain the SPECIFIC product? Measured in the language the
      // provider was actually asked in — comparing a Cyrillic query against an
      // English row name would flag every RU food outside our own table.
      // Like the coverage gate above, judged by the BEST of the display name and
      // the alias that actually MATCHED — the same «двое ворот меряют по-разному»
      // class the #219 fix closed for coverage.
      const unexplained =
        provider.queryLang === 'en' && !hasCyrillic(name)
          ? translationLost(userQuery, name) // the brand died in the translation
          : unexplainedSpecifics(userQuery, primary.name ?? name).length > 0 &&
            (primary.matchedKey === undefined ||
              unexplainedSpecifics(userQuery, primary.matchedKey).length > 0);
      if (unexplained) {
        // Keep the FIRST such hit for the same reason as above, and keep looking:
        // a later source may carry the branded product itself.
        if (!genericFallback) genericFallback = { ...hit, qualifierUnmatched: true };
        continue;
      }
      return { ...hit, donors, ...(degraded ? { degraded } : {}) };
    }
    // A row for the right food beats a thin one that barely matched anything.
    const best = genericFallback ?? weakFallback;
    return best ? { ...best, donors, ...(degraded ? { degraded } : {}) } : null;
  }

  /** Item lookup: providers may be queried by name_ru or name_en (queryLang). */
  private async lookupItem(item: IdentifiedItem, region: Region): Promise<LookupResult> {
    const key = cacheKey(`${item.name_ru}|${item.name_en}`, region);
    const cached = this.cache.get(key);
    if (cached) return cached;

    // The user-side name (RU in the RU region) is what the chain measures its
    // own answers against — the translation is ours, not the user's question.
    const found = await this.runChain(region, (p) => this.nameFor(p, item, region), this.nativeName(item, region));
    if (found) {
      const enriched = await this.backfillMicros(found, item);
      // A источник lay down during this walk, so this answer may be worse than
      // the food deserves («отруби овсяные мистраль» settling for the generic
      // row because Open Food Facts was throttled). Caching it would freeze one
      // bad minute in for the life of the process — the next parse asks again.
      if (!enriched.degraded) this.cache.set(key, enriched);
      return enriched;
    }
    return { per100: ESTIMATE_PER100, matchConfidence: 0, alternatives: [] };
  }

  /**
   * Graft vitamins, fibre and any missing minerals onto a match whose source
   * carries none — curated RU dishes (борщ, каша: `skurikhin` wins the chain
   * before USDA is ever queried) and crowd OFF products (vitamins absent by
   * construction). The primary's OWN values stay authoritative; a donor only
   * fills gaps. Result is flagged `microsEstimated` so the client can say the
   * micros are an approximate proxy, not the exact product's lab values.
   *
   * THE DONOR IS LOOKED FOR WHERE THE FOOD WAS NAMED. Rows the chain already
   * collected for this same query come first — they were answered in the user's
   * own language and cost nothing more. Only when none of them carries the
   * missing nutrient do we pay for the USDA lookup by name_en, which is a
   * translation of ours and quietly misses whole classes of food («тарелка
   * овощей» → «fresh vegetables», under the match threshold, no fibre for the
   * one food group that is mostly fibre).
   *
   * No-op when the match already has everything, is a bare estimate, or is
   * itself from USDA — and cached inside the LookupResult, so a hit pays no
   * extra call.
   */
  private async backfillMicros(found: LookupResult, item: IdentifiedItem): Promise<LookupResult> {
    const per100 = found.per100;
    if (per100.source === 'estimate') return found;
    // Vitamins and fibre are separate gaps, and only one of them used to open
    // this door. A row that carries vitamins but no `fiber` (most of the crowd
    // OFF corpus, and the curated rows SR Legacy never measured) returned here
    // and could NEVER acquire fibre — «клетчатка 0» for a plate of vegetables.
    const needsMicros = !per100.vitamins;
    const needsFiber = per100.fiber === undefined;
    if (!needsMicros && !needsFiber) return found;

    // Сначала — то, за что уже заплачено на этом же обходе. Дальше по цепочке
    // ради донора НЕ ходим: источник, ответивший первым, останавливает обход по
    // построению, и лишний запрос на каждую дыру — не та цена. Остаётся прежний
    // USDA-фолбэк по переводу.
    const donor =
      pickDonor(found.donors ?? [], per100, needsMicros, needsFiber) ??
      (per100.source === 'usda' || item.name_en.trim().length === 0 ? null : await this.usdaMicros(item.name_en));
    if (!donor) return found;

    const minerals: Minerals = { ...donor.minerals, ...per100.minerals }; // primary wins on overlap
    const merged: Per100 = { ...per100, minerals };
    // Only fill what was missing: a row consulted purely for fibre keeps its own
    // vitamins rather than having them replaced by the proxy's.
    if (needsMicros && donor.vitamins) merged.vitamins = donor.vitamins;
    // Fiber from the proxy ONLY when the primary carries none — a curated «0»
    // (or any real value) stays untouched. This fills the gap for RU dishes and
    // crowd OFF rows that omit fiber, flagged microsEstimated like the rest, so
    // клетчатка can be shown/tracked instead of silently reading as absent.
    if (merged.fiber === undefined && typeof donor.fiber === 'number') merged.fiber = donor.fiber;
    return { ...found, per100: merged, microsEstimated: true };
  }

  /** Top USDA candidate's micro block for `nameEn`, or null if none is a good
   *  enough match / it carries no micronutrients worth grafting. */
  private async usdaMicros(nameEn: string): Promise<{ minerals: Minerals; vitamins?: Vitamins; fiber?: number } | null> {
    if (!this.usda) return null;
    // USDA is English-only; the resolver queries it with name_en in every region.
    const [top] = (await this.candidatesFrom(this.usda, nameEn, 'US')).results;
    if (!top || clamp01(top.confidence) < MICRO_BACKFILL_MIN_CONFIDENCE) return null;
    const p = coercePer100(top.per100);
    const hasMinerals = Object.keys(p.minerals).length > 0;
    const hasFiber = typeof p.fiber === 'number';
    if (!p.vitamins && !hasMinerals && !hasFiber) return null;
    return {
      minerals: p.minerals,
      ...(p.vitamins ? { vitamins: p.vitamins } : {}),
      ...(hasFiber ? { fiber: p.fiber } : {}),
    };
  }

  /**
   * Free-text DB search for the manual "find it yourself" picker (disambiguation
   * layer 4). Unlike the parse path's first-hit-wins chain, this queries EVERY
   * region provider in parallel and merges in chain order (curated table first,
   * then the broad DBs, then crowd brands) — a loose curated hit no longer
   * hides the branded products, and each row carries an EXACT per-100g with its
   * source. Empty on a full miss.
   */
  async search(name: string, region: Region): Promise<SearchOutcome> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return { candidates: [], sourcesDown: false };
    const key = cacheKey(trimmed, region);
    const cached = this.searchCache.get(key);
    if (cached) return { candidates: cached, sourcesDown: false };

    // An English-only corpus (USDA) cannot match Cyrillic text — skip the
    // round-trip instead of paying its latency for guaranteed zero results.
    // Sources that declare `acceptsCyrillic` (FatSecret with its RU
    // localization) still get the query: for Cyrillic text OFF used to be the
    // ONLY provider left, so one flaky OFF timeout read as «нет в базе».
    const cyrillic = hasCyrillic(trimmed);
    // ШТРИХКОД спрашиваем только у тех, для кого код — ключ (Open Food Facts и
    // её локальный снимок). Таблица ИМЁН сопоставить цифрам нечего, и дело не
    // в потраченной латентности: падение такого провайдера поднимало
    // `sourcesDown`, телефон говорил «источник не ответил» про код, которого
    // просто нет ни в одной базе, и человек жал «повторить» до бесконечности.
    // Проверено на боевом сервере: живой OFF на такой код отвечает честным 404.
    const barcode = isBarcode(trimmed);
    const lists = await Promise.all(
      chainFor(this.providers, region).map((p) =>
        (cyrillic && p.queryLang === 'en' && !p.acceptsCyrillic) || (barcode && !p.acceptsBarcode)
          ? Promise.resolve({ results: [], unavailable: false })
          : this.candidatesFrom(p, trimmed, region),
      ),
    );
    const merged = demoteContradictions(
      trimmed,
      lists.flatMap((l) => l.results).filter((c) => c.confidence > 0),
    );
    const out = merged.slice(0, MAX_SEARCH_RESULTS).map((r) => ({
      name: r.name ?? trimmed,
      per100: coercePer100(r.per100),
      // The shared base's confirmation count — the one thing that makes a crowd
      // row honest in the picker. Absent on every table source.
      ...(r.votes === undefined ? {} : { votes: r.votes }),
    }));
    // Misses stay uncached — a later DB import may resolve them. So does a list
    // assembled while a source was down: it is a partial answer, and freezing it
    // in would keep serving one bad minute after the source recovers.
    const degraded = lists.some((l) => l.unavailable);
    if (out.length > 0 && !degraded) this.searchCache.set(key, out);
    // ЧАСТИЧНЫЙ ОТКАЗ — НЕ ОТКАЗ. Флаг существует ради ОДНОГО предложения на
    // экране: «база не ответила» вместо «такой еды нет». Пока хоть один
    // источник вернул строки, второе предложение и не понадобится — списку
    // есть что показать, — а первое становится ложью про живые базы: USDA
    // отваливается заметно чаще прочих (её отказы красили КАЖДЫЙ ответ, включая
    // те, что целиком собрала другая база). Поэтому флаг поднимается ровно
    // тогда, когда пустота может оказаться ложной: список пуст И кто-то молчал.
    const sourcesDown = degraded && out.length === 0;
    return { candidates: out, sourcesDown };
  }

  async resolveItem(item: IdentifiedItem, region: Region): Promise<NutritionItem> {
    // Net weight read off the package (масса нетто) beats a portion guess for
    // the eaten grams — used whether or not the panel itself was complete —
    // but only while the pack is small enough to plausibly be eaten in one go.
    // A bar, cup or bottle is finished whole; photographing a 950-g кефир used
    // to log the ENTIRE package as eaten (grams = net weight) until the user
    // noticed. Above the cap the visible-portion estimate wins and the label
    // supplies only the per-100g composition.
    const rawLabelWeight = item.label?.net_weight_g;
    const labelWeight =
      rawLabelWeight !== undefined && rawLabelWeight <= NET_WEIGHT_AS_EATEN_MAX_G ? rawLabelWeight : undefined;
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
              ...(est.fiber !== undefined ? { fiber: est.fiber } : {}),
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

    // БАЗИС — СВОЙСТВО ПАРЫ, А НЕ ОДНОЙ СТОРОНЫ. Вес и строка каждый стоят в
    // своём состоянии продукта (сухое / готовое), и `граммы × per100` верно
    // ТОЛЬКО когда состояния совпали. Раньше здесь сторожилось одно
    // направление — готовый вес против сухой строки, — а обратное («доширак»:
    // модель даёт вес СУХОЙ пачки, строка «лапша быстрого приготовления»
    // несёт плотность ГОТОВОГО блюда) проходило молча и занижало ВТРОЕ той же
    // самой водой. Теперь спрашиваем обе стороны и сверяем их симметрично;
    // числа по-прежнему не переписываются — расхождение поднимает флаг и
    // кладёт пересчитанную строку первой альтернативой.
    // `prepared` — факт о СТРОКЕ (curated-таблица описывает готовое блюдо), и
    // подменять им заявленный базис ВЕСА нельзя: у «доширака» именно так и
    // выходило — наблюдатель говорил «взвешена сухая пачка», а флаг строки
    // молча объявлял вес готовым, и расхождение не замечалось вовсе.
    // ДВА `prepared` ЗНАЧАТ РАЗНОЕ, и складывать их в один нельзя. Флаг
    // curated-таблицы (`found.prepared`) — про СТРОКУ: она уже описывает
    // готовое блюдо. Флаг модели (`item.prepared`) — про ЕДУ, которую человек
    // ест, то есть про ВЕС. Смешанные в одно, они глушили предупреждение не с
    // той стороны: «bowl of oatmeal» (модель: готовое) садился на сухую
    // брендовую строку 340 ккал/100 г, и 240 г миски давали 816 ккал молча.
    const weightBasis: Basis =
      item.weight_basis === 'dry'
        ? 'dry'
        : item.weight_basis === 'as_eaten'
          ? 'cooked'
          : // Поле модель молча пропускает (проверено на боевой: не выводит даже
            // как обязательное), поэтому у сервера есть свои два вывода: вес,
            // слишком малый для готовой порции этого крахмала, — сухой; а
            // блюдо, которое едят как есть, взвешивают готовым.
            weighedDry([item.name_ru, item.name_en, found.name], grams)
            ? 'dry'
            : prepared
              ? 'cooked'
              : 'unknown';
    const matchedBasis: Basis =
      found.prepared === true
        ? 'cooked' // curated finished-dish row already describes the cooked state
        : rowBasis([item.name_ru, item.name_en, found.name], found.per100);
    // Сухая строка против веса, который сухим не назвали, — прежнее правило
    // слово в слово: молчание о базисе веса тут по-прежнему читается как
    // «скорее всего готовое», потому что взвешивают обычно то, что едят.
    const dryBasis = matchedBasis === 'dry' && weightBasis !== 'dry';
    // Зеркало: вес назван сухим, а строка описывает готовое. Здесь молчания
    // быть не может — ветка живёт только на ЯВНОМ сигнале наблюдателя.
    const dryWeight = matchedBasis === 'cooked' && weightBasis === 'dry';

    // Только настоящие сорта (см. [gradesOf]): голое число в имени («хлеб 7
    // злаков») не должно ни дёргать оценщик, ни демотировать крауд-строку
    // через gradeSuspect.
    const graded = gradesOf(item.name_ru).length > 0;
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
    // A brand/variety nobody explained is exactly the case where the model's
    // class-level band is worth its call: it becomes the honest «≈ оценка ИИ для
    // <того, что человек написал>» alternative beside the generic DB row.
    if (
      !aiFull &&
      this.estimator &&
      (found.weak || found.qualifierUnmatched || gradeMiss || bandViolated || (graded && found.matchConfidence < 0.9))
    ) {
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
    // A generic row standing in for a named product is suspect by the same
    // logic as a wrong grade: right food, not the thing that was asked for.
    const suspect =
      (aiFull && refereeEstimate ? estimateMismatch(found.per100, refereeEstimate) : false) ||
      gradeSuspect ||
      bandViolated ||
      !!found.qualifierUnmatched ||
      !!found.weak;
    const confidence = suspect
      ? REFEREE_DEMOTED_CONFIDENCE
      : Math.min(item.confidence, found.matchConfidence);
    // A recognised dry starch matched on a likely-cooked weight: offer the
    // cooked-basis version (dry per-100g ÷ yield factor) as the TOP one-tap
    // alternative, so the ~3× overcount is one tap to fix. The warning still
    // shows and the user still decides — they may genuinely have weighed it dry.
    // Unknown starches keep the warning only (no reliable factor to offer).
    const cookedAlt: NutritionAlternative[] = [];
    if (dryBasis || dryWeight) {
      const yieldFactor = dryStarchYield([item.name_ru, item.name_en, found.name]);
      if (yieldFactor) {
        // Одна и та же вода, прочитанная в две стороны: строку приводим к
        // состоянию, в котором стоит ВЕС, потому что вес — то, что человек
        // действительно наблюдал.
        const label = dryBasis
          ? region === 'US'
            ? `${item.name_en}, cooked`
            : `${item.name_ru}, готовое`
          : region === 'US'
            ? `${item.name_en}, dry`
            : `${item.name_ru}, сухое`;
        const per100 = dryBasis
          ? cookedFromDry(found.per100, yieldFactor)
          : dryFromCooked(found.per100, yieldFactor);
        cookedAlt.push({ name: label, per100 });
      }
    }
    const alternatives: NutritionAlternative[] = [
      ...cookedAlt,
      ...(suspect && aiFull ? [{ name: item.name_ru, per100: aiFull }, ...found.alternatives] : found.alternatives),
    ];

    // РАСХОЖДЕНИЕ БАЗИСОВ — АРИФМЕТИЧЕСКАЯ ОШИБКА, А НЕ РАЗНИЦА МНЕНИЙ. Когда
    // вес заведомо сухой, а строка описывает готовое, «граммы × per100» —
    // просто неверное умножение, и оставить его главным числом значит соврать
    // втрое («доширак» 121 ккал вместо ~400). Поэтому строку приводим к
    // состоянию веса ТОЙ ЖЕ таблицей выходов, что уже работает в обратную
    // сторону (USDA Cooking Yields, docs/nutrition-science.md §6), исходную
    // строку оставляем первой альтернативой, а плашка говорит, что произошло.
    // Обратное направление (сухая строка × готовый вес) так НЕ лечится: там
    // сигнал слабее — молчание о базисе значит «скорее всего готовое».
    // Расхождение лечится в ОБЕ стороны и по одному правилу: когда базис веса
    // ИЗВЕСТЕН (наблюдатель назвал его или он выводится однозначно), строка
    // приводится к нему. Когда базис веса молчит — только предупреждение:
    // догадка о том, чего никто не говорил, и есть тот способ сломать честную
    // половину корпуса.
    const rebased = dryWeight || (dryBasis && weightBasis === 'cooked') ? (cookedAlt[0]?.per100 ?? null) : null;
    const per100 = rebased ?? found.per100;

    return {
      name_ru: item.name_ru,
      name_en: item.name_en,
      grams,
      grams_source: 'estimated',
      confidence,
      per100,
      scaled: scaleToGrams(per100, grams),
      approximate: true, // estimated grams → approximate until the user confirms
      // Transparency: tell the client WHICH row was matched, not just its
      // numbers — the row's own name usually carries the preparation state.
      ...(found.name ? { matched_name: found.name } : {}),
      ...(prepared ? { prepared: true } : {}),
      ...(dryBasis ? { dry_basis: true } : {}),
      ...(dryWeight ? { dry_weight: true } : {}),
      ...(rebased ? { basis_adjusted: true } : {}),
      ...(found.microsEstimated ? { micros_estimated: true } : {}),
      ...(rebased
        ? {
            alternatives: [
              { name: found.name ?? item.name_ru, per100: found.per100 },
              ...alternatives.slice(1),
            ].slice(0, MAX_ALTERNATIVES),
          }
        : alternatives.length > 0
          ? { alternatives: alternatives.slice(0, MAX_ALTERNATIVES) }
          : {}),
    };
  }
}

/**
 * The first row among `donors` that actually carries what the primary lacks —
 * skipping the primary itself (same object) and anything with nothing to give.
 * Rows are already ordered by the chain's own trustworthiness.
 */
function pickDonor(
  donors: Per100[],
  primary: Per100,
  needsMicros: boolean,
  needsFiber: boolean,
): { minerals: Minerals; vitamins?: Vitamins; fiber?: number } | null {
  for (const d of donors) {
    if (d === primary) continue;
    const givesVitamins = needsMicros && !!d.vitamins;
    const givesFiber = needsFiber && typeof d.fiber === 'number';
    const givesMinerals = Object.keys(d.minerals).length > 0 && Object.keys(primary.minerals).length === 0;
    if (!givesVitamins && !givesFiber && !givesMinerals) continue;
    return {
      minerals: d.minerals,
      ...(givesVitamins && d.vitamins ? { vitamins: d.vitamins } : {}),
      ...(givesFiber ? { fiber: d.fiber } : {}),
    };
  }
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
