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
 */
export function contradictsSugarFree(per100: { sugar?: number; carb: number }): boolean {
  if (typeof per100.sugar === 'number') return per100.sugar > SUGAR_FREE_MAX_G;
  return per100.carb > 10;
}

/** Contradicting rows are capped to this confidence — below the client's 0.5 floor. */
const CONTRADICTION_CONFIDENCE = 0.4;

/**
 * Adjust candidates when their composition contradicts what the query
 * explicitly asked for (currently: sugar-negation).
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
export function demoteContradictions<T extends { per100: { sugar?: number; carb: number }; confidence: number }>(
  query: string,
  results: T[],
): T[] {
  if (results.length === 0 || !isSugarFreeQuery(query)) return results;
  const promoted: T[] = [];
  const rest: T[] = [];
  for (const r of results) {
    if (contradictsSugarFree(r.per100)) {
      rest.push({ ...r, confidence: Math.min(r.confidence, CONTRADICTION_CONFIDENCE) });
    } else if (r.confidence > CONTRADICTION_CONFIDENCE) {
      promoted.push(r);
    } else {
      rest.push(r);
    }
  }
  return [...promoted, ...rest];
}
