import { tokenScore } from './ruSearch.js';

/**
 * Candidate ranking for nutrition lookups (disambiguation layer 1). Providers
 * like FatSecret/USDA return a LIST for one query — blindly taking `[0]` often
 * picks a branded or off-topic row. These pure helpers score each candidate's
 * NAME against the query and nudge generic/whole foods ahead of brands, so the
 * resolver can pick the best match AND surface the runners-up as alternatives.
 *
 * Pure + total: never throws, no network. Latin and Cyrillic both supported.
 */

/** Lowercase, ё→е, strip punctuation, collapse whitespace. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 0..1 similarity between a query and a candidate name. Token Jaccard, plus a
 * bonus when one string contains the other (qualifiers like "raw"/"отварная"
 * shouldn't tank a match) and when the candidate covers every query token.
 */
export function scoreName(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (q.length === 0 || c.length === 0) return 0;
  if (q === c) return 1;

  const qt = new Set(q.split(' '));
  const ct = new Set(c.split(' '));
  let inter = 0;
  for (const w of qt) if (ct.has(w)) inter++;
  const union = new Set([...qt, ...ct]).size;
  const jaccard = union === 0 ? 0 : inter / union;

  const sub = c.includes(q) || q.includes(c) ? 0.2 : 0;
  const covers = [...qt].every((w) => ct.has(w)) ? 0.15 : 0;
  return Math.min(1, jaccard + sub + covers);
}

/**
 * Share of the QUERY's own words the candidate actually accounts for (0..1).
 *
 * Distinct from [scoreName] on purpose. Jaccard answers "how similar are these
 * two names"; this answers "did we explain what the user asked for". They come
 * apart exactly where the resolver used to break: «tarragon soda Chernogolovka»
 * against USDA «Tarragon, dried» shares one token of three — Jaccard 0.25, which
 * [scoreToConfidence] then floors to a respectable-looking 0.4, while `soda` and
 * `chernogolovka` (the words that say what the thing IS) went unexplained. The
 * result was a dried herb served as a bottle of lemonade: 295 kcal and 22.8 g
 * protein per 100 g.
 *
 * Coverage stays honest there (0.33) because unmatched query tokens count
 * against it directly.
 */
/**
 * A query word counts as covered at the same tolerance that FOUND the row —
 * exact, prefix, same stem, or one typo ([tokenScore] ≥ 0.6).
 *
 * It used to be raw string equality, and that quietly discarded the curated
 * table for every inflected form a person actually types: «помидоры» against the
 * row «помидор» scored 0.00 and «огурцы» against «огурец» scored 0.00 — no
 * shared word, though the RU matcher had just ranked them 0.85 and 0.95. The row
 * was demoted to a fallback, the walk continued, and a brand row whose NAME
 * happened to contain the literal word form won instead: «огурцы» came back as
 * «Тёща огурцы бочковые», 4 ккал of pickles (owner report 2026-08-23).
 *
 * Two gates measuring the same thing by different rules is how a match gets
 * found and then thrown away.
 */
const TOKEN_COVERED = 0.6;

export function queryCoverage(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (q.length === 0 || c.length === 0) return 0;
  const all = [...new Set(q.split(' '))].filter((w) => w.length > 0);
  // Голые числа не участвуют в покрытии: [normalizeName] уже растворил «5%» и
  // «3.2» в целые, а имя строки цифру не «объясняет» почти никогда — «хлеб 7
  // злаков» против честной «хлеб зерновой» давал 1/3 и клеймил строку weak, и
  // ИИ-оценка вставала поверх таблицы (аудит 2026-08-26). Сорта судит резолвер
  // (gradesOf по сырому имени), не эти ворота. Запрос из ОДНИХ цифр (штрихкод
  // руками в поиск) сравнивается как раньше — там цифры и есть содержание.
  const meaningful = all.filter((w) => !/^\d+$/.test(w));
  const qt = meaningful.length > 0 ? meaningful : all;
  if (qt.length === 0) return 0;
  const ct = c.split(' ').filter((w) => w.length > 0);
  let hit = 0;
  for (const w of qt) {
    let best = 0;
    for (const k of ct) {
      const score = tokenScore(w, k);
      if (score > best) best = score;
    }
    if (best >= TOKEN_COVERED) hit += 1;
  }
  return hit / qt.length;
}

/**
 * Below this share of the query's own words, a hit is too thin to STOP the
 * provider chain. It is not thrown away — it is remembered as a fallback while
 * the remaining sources (Open Food Facts for brands, FatSecret) get their turn.
 * Half is deliberately lenient: qualifiers the DB omits («варёная», «домашний»)
 * routinely cost a token or two without making the match wrong.
 */
export const MIN_CHAIN_COVERAGE = 0.5;

/** Prefer generic/whole foods; lightly penalize branded products. */
export function genericBonus(foodType?: string): number {
  if (!foodType) return 0;
  if (/generic/i.test(foodType)) return 0.1;
  if (/brand/i.test(foodType)) return -0.05;
  return 0;
}

export interface ScoredCandidate<T> {
  value: T;
  name: string;
  score: number; // 0..1
}

/** Rank candidates best-first by name similarity + generic preference. */
export function rankByName<T>(
  query: string,
  candidates: { value: T; name: string; foodType?: string }[],
): ScoredCandidate<T>[] {
  return candidates
    .map((c) => {
      const nameScore = scoreName(query, c.name);
      // genericBonus is a TIE-BREAKER among name-relevant candidates, not a
      // relevance signal of its own. A row that shares NOTHING with the query
      // must stay at 0 — otherwise a "Generic" milk row scores 0.1 on a salad
      // query, floors to 0.4 confidence, and survives the resolver's junk
      // filter (the salad→milk bug). Only nudge once the name already matches.
      const score = nameScore <= 0 ? 0 : Math.max(0, Math.min(1, nameScore + genericBonus(c.foodType)));
      return { value: c.value, name: c.name, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Map a 0..1 name score to a provider confidence. A real-but-terse hit is
 * floored at 0.4 so it never reads as junk — BUT a candidate that shares
 * NOTHING with the query (score 0: no common token, no substring) is not a
 * match at all and must return 0, not the floor. Otherwise a broad free-text
 * provider (e.g. FatSecret returning milk rows for «овощной салат») would have
 * its garbage promoted to a confident 0.4 hit, stop the chain, and outrank the
 * honest AI-estimate fallback.
 */
export function scoreToConfidence(score: number): number {
  if (score <= 0) return 0;
  return Math.min(1, Math.max(0.4, score));
}

// ---- composition-vs-query contradiction (disambiguation layer 1.5) ----------

/** «без сахара» / zero / sugar-free / диет… — the query asks for a no-sugar product. */
export function isSugarFreeQuery(query: string): boolean {
  const q = normalizeName(query);
  // NB: JS \b doesn't work around Cyrillic (\w is Latin-only), so RU markers
  // are matched as plain substrings of the normalized query.
  return /без сахара|sugar ?free|no sugar|\bzero\b|зеро|диет|\bdiet\b|лайт|\blight\b/.test(q);
}

/** Grams of sugar per 100 g a "sugar-free" product may plausibly carry. */
const SUGAR_FREE_MAX_G = 2.5;

/**
 * True when the candidate's composition plainly contradicts a sugar-free
 * query: explicit sugar above the threshold, or — when the row carries no
 * sugar field — carbs high enough that they cannot be sugar-free-drink water
 * (name ranking alone happily matches «энергетик БЕЗ САХАРА» to a sugared
 * energy drink: same tokens, opposite product).
 *
 * The carb heuristic is calibrated for DRINKS and lies about solids: «печенье
 * без сахара» carries 40–60 g of carbs from flour and polyols legitimately. A
 * row whose OWN NAME asserts the sugar-free property (FatSecret and the RU
 * tables ship no sugar field at all) is therefore exempt from the heuristic —
 * only an EXPLICIT sugar figure may still overrule such a name.
 */
export function contradictsSugarFree(
  per100: { sugar?: number; carb: number },
  candidateName?: string,
): boolean {
  if (typeof per100.sugar === 'number') return per100.sugar > SUGAR_FREE_MAX_G;
  if (typeof candidateName === 'string' && isSugarFreeQuery(candidateName)) return false;
  return per100.carb > 10;
}

/** Contradicting rows are capped to this confidence — below the client's 0.5 floor. */
const CONTRADICTION_CONFIDENCE = 0.4;

// ---- cooking-method contradiction (name vs name) ---------------------------
//
// The coverage gate only asks "did the row explain the QUERY's words" — a
// candidate's own EXTRA method word costs it nothing. So «куриное филе
// отварное» happily matched USDA «chicken fillet, breaded»: chicken+fillet
// covered, «отварное» forgiven as a qualifier, and the breading (+100 kcal and
// +10 g fat per 100 g of flour and frying oil) rode in silently — the same
// silent-substitution class as the творог 5%→2% swap (owner report 2026-08-25).
//
// Methods are grouped by CALORIC consequence, not linguistics, and only the
// added-fat group is worth demoting over: boiled vs stewed vs steamed are the
// same lean food, and boiled-vs-roasted differs by a rounding error — while
// boiled-vs-breaded/fried is the whole error the user came to report. Demoting
// dry-heat against moist would also throw away USDA's canonical plain rows
// («…meat only, cooked, roasted») on every «отварное» query — a regress.
const METHOD_MOIST = /отварн|варен(?!ь)|тушен|припущ|на пару|паров|boil|stew|poach|steam/;
// NB: \b is Latin-only in JS, which is exactly right here — it keeps «fryers»
// (the USDA breed word in «broilers or fryers») from reading as a method.
const METHOD_FAT = /жарен|обжар|панир|фритюр|темпур|\bfried\b|\bfry\b|\bfries\b|breaded|batter|tempura|нагетс|nugget/;
// «печен(?!ь)» keeps liver (печень) and cookies (печенье) out of the ovens.
const METHOD_DRY = /запечен|печен(?!ь)|гриль|мангал|барбекю|baked|\broast|grill|barbecu|\bbbq\b/;

const METHOD_GROUPS: readonly RegExp[] = [METHOD_MOIST, METHOD_FAT, METHOD_DRY];
const FAT_BIT = 1 << METHOD_GROUPS.indexOf(METHOD_FAT);

/** Bitmask of method groups named in the string (normalized internally). */
function methodBits(name: string): number {
  const n = normalizeName(name);
  let bits = 0;
  for (const [i, re] of METHOD_GROUPS.entries()) if (re.test(n)) bits |= 1 << i;
  return bits;
}

/**
 * The candidate names a preparation the query ruled out, and the gap is the
 * added-fat one — «отварное» vs breaded/fried in either direction. Shared
 * groups (query «жареная», row «в панировке» — both fat-added) and rows that
 * name no method at all («куриная грудка») are consistent, not contradictions.
 */
export function contradictsMethod(queryBits: number, candidateName: string): boolean {
  if (queryBits === 0) return false;
  const c = methodBits(candidateName);
  if (c === 0 || (queryBits & c) !== 0) return false;
  return ((queryBits | c) & FAT_BIT) !== 0;
}

/**
 * Adjust candidates when they contradict what the query explicitly asked for:
 * composition against a sugar-negation («без сахара» → sugared row), or a named
 * cooking method against the added-fat gap («отварное» → «в панировке» row).
 *
 * Contradicting rows keep their relative order with confidence capped below
 * the client's low-confidence floor (0.5): if nothing clean exists, the top
 * pick is honestly flagged and the alternatives picker opens proactively
 * instead of the wrong product reading as fact.
 *
 * A clean row is promoted above them ONLY when its confidence is STRICTLY
 * above the cap. `scoreToConfidence` floors weak name matches at exactly 0.4,
 * so a floored unrelated-but-clean row («конфеты без сахара» on an
 * energy-drink query) never jumps ahead — while a true «зеро» variant shares
 * the query tokens, scores above the floor, and wins. Comparing against the
 * head's confidence instead would be meaningless in the floored tail.
 */
/**
 * One row contradicts the query — by composition (sugar-negation) or by a named
 * cooking method. Shared by [demoteContradictions] and the resolver's chain
 * walk: a contradicting primary must not STOP the walk, because a later source
 * may carry the food as actually asked (FatSecret's RU rows often do).
 */
export function contradictsQuery(
  query: string,
  row: { name?: string; per100: { sugar?: number; carb: number } },
): boolean {
  if (isSugarFreeQuery(query) && contradictsSugarFree(row.per100, row.name)) return true;
  return typeof row.name === 'string' && contradictsMethod(methodBits(query), row.name);
}

export function demoteContradictions<
  T extends { name?: string; per100: { sugar?: number; carb: number }; confidence: number },
>(query: string, results: T[]): T[] {
  if (results.length === 0 || (!isSugarFreeQuery(query) && methodBits(query) === 0)) return results;
  const promoted: T[] = [];
  const rest: T[] = [];
  for (const r of results) {
    if (contradictsQuery(query, r)) {
      rest.push({ ...r, confidence: Math.min(r.confidence, CONTRADICTION_CONFIDENCE) });
    } else if (r.confidence > CONTRADICTION_CONFIDENCE) {
      promoted.push(r);
    } else {
      rest.push(r);
    }
  }
  return [...promoted, ...rest];
}
