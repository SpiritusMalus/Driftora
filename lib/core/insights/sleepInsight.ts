/**
 * Honest "what your sleep means" classifier — part of the meaning-rules library
 * alongside `stepInsight` (Ideas-2026-06-16 §2: a second zero-effort passive
 * signal with one plain-language line).
 *
 * Evidence (medical guidance, NOT a marketing number):
 *  - Adults do best on ~7–9 h/night. (AASM/SRS consensus 2015; Sleep Health
 *    Foundation.) Below ~6 h is associated with higher cardiometabolic and mood
 *    risk; routinely well above ~9 h can itself flag something worth noticing.
 *  - We never imply "more is better" and never scold a short night — one bad
 *    night is noise, not a verdict.
 *
 * Pure: no DB, no i18n. Returns a band; the UI composes the localized sentence
 * (same split-of-concerns as `bodyMind`/`autoWins`). Minutes, not hours, so the
 * stored `sleep_days.minutes` feeds it directly.
 */

export type SleepBand = 'unknown' | 'very_short' | 'short' | 'ample' | 'long';

/// Lower edge (minutes) of the recommended adult range — 7 h.
export const SLEEP_AMPLE_MIN = 420;
/// Upper edge (minutes) of the recommended adult range — 9 h.
export const SLEEP_AMPLE_MAX = 540;

/// Classifies a night's sleep (in minutes) into an evidence-based band.
/// `null`/non-positive minutes = "unknown" (no data synced yet) — the UI shows
/// a neutral "not enough data" line, never a zero-sleep judgement.
export function sleepBand(minutes: number | null): SleepBand {
  if (minutes == null || minutes <= 0) return 'unknown';
  if (minutes < 360) return 'very_short'; // under 6 h
  if (minutes < SLEEP_AMPLE_MIN) return 'short'; // 6–7 h
  if (minutes <= SLEEP_AMPLE_MAX) return 'ample'; // 7–9 h
  return 'long'; // over 9 h
}

/// Formats minutes as a short "Хч"/"Hh Mm"-agnostic decimal-hour value the UI
/// can drop into copy, e.g. 450 → 7.5. (The unit word comes from i18n.)
export function sleepHours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}
