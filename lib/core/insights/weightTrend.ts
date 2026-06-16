/**
 * A neutral, non-judgmental summary of the body-weight trend (Roadmap §5: no
 * weigh-in pressure, no "good/bad" framing — weight fluctuates day to day).
 *
 * Pure: takes dated weight points and reports the net change across the span.
 * The UI states the change plainly; `direction` only picks wording, never
 * praise or blame. A change under `FLAT_THRESHOLD_KG` reads as "steady" so daily
 * water-weight noise isn't dramatized.
 */

export interface WeightPoint {
  date: string; // 'YYYY-MM-DD'
  weightKg: number;
}

/// Net changes smaller than this read as "steady" — below the noise floor of
/// normal day-to-day fluctuation.
export const FLAT_THRESHOLD_KG = 0.3;

export interface WeightTrend {
  latestKg: number;
  deltaKg: number; // signed: negative = down over the span
  spanDays: number;
  direction: 'down' | 'up' | 'steady';
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/// Summarizes the trend across the given points, or null if there aren't at
/// least two (a single weigh-in has no trend to report).
export function summarizeWeightTrend(points: WeightPoint[]): WeightTrend | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const deltaKg = round1(last.weightKg - first.weightKg);
  const direction =
    Math.abs(deltaKg) < FLAT_THRESHOLD_KG ? 'steady' : deltaKg < 0 ? 'down' : 'up';
  return {
    latestKg: round1(last.weightKg),
    deltaKg,
    spanDays: daysBetween(first.date, last.date),
    direction,
  };
}
