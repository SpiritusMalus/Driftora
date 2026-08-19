import { createRecordLog } from '../billing/recordLog.js';
import { coercePer100, type Per100, type Region } from '../types.js';
import { energyInconsistent } from './energy.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { phraseScore } from './ruSearch.js';
import { normalizeName } from './scoring.js';

/**
 * THE SHARED FOOD BASE — the dishes no table has, filled by the people eating
 * them.
 *
 * Skurikhin has «борщ» and USDA has «chicken breast», but neither has шаурма из
 * ларька у метро, хачапури по-аджарски, or бабушкины сырники — and those are
 * exactly the foods a Russian user logs every day. Today each person types the
 * macros for their local dish alone, into their own device, forever. This is the
 * shared layer: what one person confirmed once, the next person finds by name.
 *
 * WHAT IS STORED, EXACTLY: a food name, a region, and per-100g macros. Nothing
 * else. No install id, no IP, no timestamp, no account — the row cannot be
 * traced to whoever contributed it, because nothing identifying is ever written
 * (the route strips everything else before it reaches this module). The base is
 * public by construction, so contributing is OPT-IN on the device and never the
 * user's meal text, weights, or times — only the food and its composition.
 *
 * HONESTY: a community row is `source: 'community'` and carries its `votes`, so
 * the app can say «из общей базы · записей: 12» rather than dressing a stranger's
 * numbers as a measurement. It never outranks a composition table — the provider
 * sits BELOW Skurikhin and USDA in the chain (see `buildProviders`).
 *
 * AGGREGATION: per-100g is the MEDIAN of every confirmation, not the newest and
 * not the mean — one person typing 3000 kcal moves the median by nothing once a
 * few honest entries exist, and moves the mean a lot. Samples are capped per
 * food (oldest evicted), so a single spammer's ceiling is the cap.
 */

/** One person's confirmed per-100g for a food. Macros only — see MICROS below. */
export interface CommunitySample {
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
  fiber?: number;
  sugar?: number;
  satFat?: number;
}

/** One food in the shared base: its key, display name, and every confirmation. */
export interface CommunityFood {
  key: string; // `${region}::${normalized name}` — the identity of a food here
  region: Region;
  name: string; // the first contributed spelling, shown as-is
  samples: CommunitySample[];
}

/**
 * MICROS are deliberately absent. A community row carries macros and nothing
 * else: nobody types iron and B12 off a shawarma, so a mineral block here would
 * be invented, and the app's micro scales promise "only what the source has,
 * никаких выдуманных нулей". The USDA back-fill in the resolver still applies
 * to community matches like it does to curated RU rows.
 */
const NO_MINERALS = {} as const;

/** How many confirmations we keep per food. Beyond this the oldest is evicted. */
export const MAX_SAMPLES = 32;

/** Candidates one query may draw from the shared base. */
const MAX_CANDIDATES = 5;

/**
 * Below this phrase relevance a row is noise, not a candidate — the same floor
 * the curated RU table uses, and for the same reason: one matched word out of
 * two must not drag in an unrelated dish.
 */
const MIN_SCORE = 0.55;

/** Longest food name we accept. Longer is a sentence, not a dish. */
export const MAX_NAME_LEN = 60;

/** Most words a food name may have. «плов с бараниной по-домашнему» is 4. */
const MAX_NAME_WORDS = 6;

/**
 * Junk/abuse floor for a name that becomes searchable BY EVERYONE. This is not
 * moderation — it is the cheap filter that keeps links, addresses, mentions and
 * the most obvious obscenities out of a public list without pretending to judge
 * content. Anything subtler needs a human, and the honest answer is that this
 * base has none: keep the surface small (a food name, ≤ 60 chars, mostly
 * letters) so there is little to abuse.
 */
// A dot BETWEEN LETTERS is a domain, never a food: «молоко 1.8%» keeps its
// decimal (digit-dot-digit) and «St. Louis ribs» keeps its abbreviation (the
// space breaks the run), while shop.example / t.me / любой.сайт do not pass.
const LINKISH = /(https?:|www\.|@|\/\/|\p{L}\.\p{L})/iu;
/** Obscene roots (RU + EN), matched as substrings on the normalized name. */
const OBSCENE = [
  'хуй', 'хуе', 'хуё', 'пизд', 'ебат', 'ебан', 'ебал', 'еблан', 'бляд', 'пидор', 'пидар', 'мудак',
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'asshole',
];

/**
 * Normalize a food name into the base's key: the same normalization the ranking
 * uses, so «Шаурма  с Курицей» and «шаурма с курицей» are ONE food and not two
 * rows nobody can reconcile.
 */
export function normalizeCommunityName(name: string): string {
  return normalizeName(name);
}

/** The identity of a food in the base: region + normalized name. */
export function communityKey(region: Region, name: string): string {
  return `${region}::${normalizeCommunityName(name)}`;
}

/**
 * The name as we will store and show it, or null when it must not enter a public
 * list. Trims whitespace, collapses runs, and refuses: empty, over-long, digit
 * or punctuation soup, links/handles, and obvious obscenity.
 */
export function sanitizeFoodName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip control characters (incl. the bidi overrides that let a name render
  // as something other than what is stored) before anything else looks at it.
  const name = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length === 0 || name.length > MAX_NAME_LEN) return null;
  if (LINKISH.test(name)) return null;

  const normalized = normalizeCommunityName(name);
  if (normalized.length === 0) return null;
  if (normalized.split(' ').length > MAX_NAME_WORDS) return null;
  // A name has to be a name: at least half of it letters, and at least two of
  // them, so «250», «100 г» and «!!!» never become entries in a shared list.
  const letters = [...normalized].filter((c) => /\p{L}/u.test(c)).length;
  if (letters < 2 || letters * 2 < normalized.replace(/\s/g, '').length) return null;
  if (OBSCENE.some((root) => normalized.includes(root))) return null;
  return name;
}

/** Round a macro to the one decimal the rest of the pipeline uses. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * A contribution we are willing to store, or null.
 *
 * Bounds first (nothing per 100 g exceeds 100 g of a macro or ~900 kcal — pure
 * fat is 900), then internal consistency: stated kcal must be reconcilable with
 * the macros by Atwater. That single check rejects the common real mistakes —
 * a per-portion kcal typed against per-100g macros, a transposed fat↔carb, a
 * misplaced decimal — without needing to know what the food is.
 */
export function sanitizeSample(raw: unknown): CommunitySample | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kcal = finite(r.kcal);
  const prot = finite(r.prot);
  const fat = finite(r.fat);
  const carb = finite(r.carb);
  if (kcal === null || prot === null || fat === null || carb === null) return null;
  if (kcal < 0 || kcal > 900) return null;
  if (prot < 0 || fat < 0 || carb < 0) return null;
  if (prot > 100 || fat > 100 || carb > 100) return null;
  if (prot + fat + carb > 100.5) return null; // 100 g cannot hold more than 100 g
  // An all-zero row is what an empty form posts, not a food.
  if (kcal === 0 && prot === 0 && fat === 0 && carb === 0) return null;
  if (energyInconsistent({ kcal, prot, fat, carb })) return null;

  const out: CommunitySample = {
    kcal: Math.round(kcal),
    prot: round1(prot),
    fat: round1(fat),
    carb: round1(carb),
  };
  // Extended label fields ride along only when actually given and in range —
  // each is a component of the macros above, so it can never exceed them.
  const fiber = finite(r.fiber);
  const sugar = finite(r.sugar);
  const satFat = finite(r.satFat);
  if (fiber !== null && fiber >= 0 && fiber <= carb + 0.5) out.fiber = round1(fiber);
  if (sugar !== null && sugar >= 0 && sugar <= carb + 0.5) out.sugar = round1(sugar);
  if (satFat !== null && satFat >= 0 && satFat <= fat + 0.5) out.satFat = round1(satFat);
  return out;
}

/** Middle value (mean of the two middles on an even count). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const value = sorted.length % 2 === 1 ? sorted[mid]! : ((sorted[mid - 1]! + sorted[mid]!) / 2);
  return value;
}

/**
 * The per-100g the base serves for a food: the MEDIAN of every confirmation.
 * Optional fields are the median of the samples that actually carry them —
 * absent stays absent (never zero-filled), same contract as every other source.
 */
export function aggregate(samples: CommunitySample[]): Per100 | null {
  if (samples.length === 0) return null;
  const per100: Record<string, unknown> = {
    source: 'community',
    kcal: median(samples.map((s) => s.kcal)),
    prot: median(samples.map((s) => s.prot)),
    fat: median(samples.map((s) => s.fat)),
    carb: median(samples.map((s) => s.carb)),
    minerals: NO_MINERALS,
  };
  for (const key of ['fiber', 'sugar', 'satFat'] as const) {
    const present = samples.map((s) => s[key]).filter((v): v is number => v !== undefined);
    if (present.length > 0) per100[key] = median(present);
  }
  return coercePer100(per100);
}

/** The store the provider reads and the contribute route writes. */
export interface CommunityFoods {
  /** Record one confirmation. Returns the food's new confirmation count, or 0 if refused. */
  add: (region: Region, name: string, sample: CommunitySample) => number;
  /** Ranked matches for a free-text query, best-first. */
  search: (query: string, region: Region) => { food: CommunityFood; score: number }[];
  /** How many distinct foods the base holds (for /metrics and tests). */
  size: () => number;
}

function isCommunityFood(rec: unknown): boolean {
  if (rec === null || typeof rec !== 'object') return false;
  const r = rec as Record<string, unknown>;
  return (
    typeof r.key === 'string' &&
    (r.region === 'RU' || r.region === 'US') &&
    typeof r.name === 'string' &&
    Array.isArray(r.samples) &&
    r.samples.length > 0
  );
}

/**
 * The shared base, persisted as an append-only JSONL log (one line per food,
 * last line wins — the same shape billing uses, and for the same reason: this is
 * a few thousand rows, not a database's worth of problem).
 *
 * `path` empty ⇒ memory only, which is what the tests and an unconfigured
 * deployment get. The feature is then simply off: nothing is stored and nothing
 * is served, rather than silently half-working.
 */
export function createCommunityFoods(path: string): CommunityFoods {
  const log = createRecordLog<CommunityFood>(path, (rec) => rec.key, isCommunityFood);

  return {
    add(region, name, sample) {
      const display = sanitizeFoodName(name);
      if (!display) return 0;
      const key = communityKey(region, display);
      const existing = log.get(key);
      // Newest last; the oldest confirmation falls off the front at the cap, so
      // a food that changed (a recipe, a reformulated product) drifts toward
      // what people log NOW instead of being pinned by its first entries.
      const samples = [...(existing?.samples ?? []), sample].slice(-MAX_SAMPLES);
      // The FIRST spelling stays the display name: later contributors keep the
      // same food (the key is normalized) without renaming it under each other.
      log.put({ key, region, name: existing?.name ?? display, samples });
      return samples.length;
    },

    search(query, region) {
      const q = normalizeCommunityName(query);
      if (q.length === 0) return [];
      const scored: { food: CommunityFood; score: number }[] = [];
      for (const food of log.values()) {
        if (food.region !== region) continue;
        const score = phraseScore(q, normalizeCommunityName(food.name));
        if (score >= MIN_SCORE) scored.push({ food, score });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
    },

    size: () => log.size(),
  };
}

/**
 * The shared base as a nutrition provider, so one lookup path serves both the
 * parse chain and the manual «найти вручную» search.
 *
 * Confidence is capped BELOW a table hit on purpose: these are other people's
 * numbers. The chain already puts this provider after Skurikhin and USDA, and
 * the cap keeps it from beating them on a tie inside the merged search results.
 */
export class CommunityProvider implements NutritionProvider {
  readonly name = 'community';
  readonly regions = ['RU', 'US'] as const;

  constructor(private readonly base: CommunityFoods) {}

  /** A confirmed row reads as a solid-but-not-certain match; fuzzier scales down. */
  private confidenceOf(score: number, votes: number): number {
    // More confirmations, more trust — but never above a curated table's 0.95.
    const confirmed = Math.min(0.15, 0.05 * votes);
    return Math.min(0.85, 0.35 + 0.4 * score + confirmed);
  }

  private toResult(food: CommunityFood, score: number): ProviderResult | null {
    const per100 = aggregate(food.samples);
    if (!per100) return null;
    const votes = food.samples.length;
    return { per100, confidence: this.confidenceOf(score, votes), name: food.name, votes };
  }

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    return (await this.searchMany(name, region))[0] ?? null;
  }

  async searchMany(name: string, region: Region): Promise<ProviderResult[]> {
    return this.base
      .search(name, region)
      .map((hit) => this.toResult(hit.food, hit.score))
      .filter((r): r is ProviderResult => r !== null);
  }
}
