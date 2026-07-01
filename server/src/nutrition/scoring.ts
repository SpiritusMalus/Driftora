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
    .map((c) => ({
      value: c.value,
      name: c.name,
      score: Math.max(0, Math.min(1, scoreName(query, c.name) + genericBonus(c.foodType))),
    }))
    .sort((a, b) => b.score - a.score);
}

/** Map a 0..1 name score to a provider confidence, floored so a real hit never reads as junk. */
export function scoreToConfidence(score: number): number {
  return Math.min(1, Math.max(0.4, score));
}
