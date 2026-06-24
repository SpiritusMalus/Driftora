/**
 * Deterministic phrase rotation for the insight library.
 *
 * Every meaning-line engine (`proteinInsight`, `stepInsight`, `daySummary`, …)
 * returns one sentence per state, so a daily user otherwise sees the identical
 * text forever — the "robot" feel (Ideas §"phrases"). `pickVariant` lets an
 * engine hold several equivalent phrasings and choose one *deterministically*
 * from a stable seed (entry count, day-of-year), so the line varies across
 * days/meals yet is stable on re-render and fully unit-testable. No
 * `Math.random` here — the insights library stays pure.
 *
 * This is the enabling refactor for the A1/A2/B2/B3/B4 copy briefs; adding the
 * extra phrasings is their job, not this one's.
 */

/// Pick one variant deterministically by `seed`. A single-element array returns
/// that element unchanged (byte-identical legacy behavior). An empty array
/// throws — a caller bug, never silently masked. Negative / non-finite seeds
/// are normalized into range rather than reaching out of bounds.
export function pickVariant<T>(variants: readonly T[], seed: number): T {
  const n = variants.length;
  if (n === 0) {
    throw new Error('pickVariant: variants must not be empty');
  }
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  const i = ((s % n) + n) % n;
  return variants[i];
}

/// Day-of-year (1–366) for a stable per-day seed, in the user's local time —
/// the line changes day to day but never mid-day.
export function dayOfYear(date: Date = new Date()): number {
  // Difference of two UTC midnights built from the *local* Y/M/D — so a DST
  // shift between Jan 1 and today can't nudge the count across a day boundary.
  const startUTC = Date.UTC(date.getFullYear(), 0, 0);
  const todayUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((todayUTC - startUTC) / 86_400_000);
}

/// Fold several small integers (e.g. day-of-year + today's entry count) into one
/// stable, non-negative seed without randomness. Order-sensitive, deterministic.
export function stableSeed(...parts: number[]): number {
  let h = 0;
  for (const p of parts) {
    h = (h * 31 + Math.trunc(p)) | 0;
  }
  return Math.abs(h);
}
