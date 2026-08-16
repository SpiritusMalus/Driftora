/**
 * Honest, supportive "what your protein means" copy — part of the meaning-rules
 * library alongside `stepInsight` (Ideas §3: every screen should answer "so
 * what?").
 *
 * Framing rules (ED safeguard, Roadmap §5): protein is a habit to *grow*, never
 * a limit to police. We talk about satiety and keeping muscle while losing
 * weight — never calories, never "too much". One short, non-judgmental sentence.
 *
 * Returns an i18n key under `insights.protein.*`, matching `stepInsight` (the
 * daySummary convention: the module stays pure, the words live in the locale
 * files — the unit test enforces the ED rules on both locales' strings).
 */

import { pickVariant } from './variant';

export type ProteinBand = 'unset' | 'none' | 'low' | 'building' | 'met';

/// Classifies today's protein against the personal target. A target of 0 means
/// "not set" (a fresh profile) — we still say something useful, just generic.
export function proteinBand(proteinG: number, targetG: number): ProteinBand {
  if (targetG <= 0) return 'unset';
  if (proteinG <= 0) return 'none';
  const ratio = proteinG / targetG;
  if (ratio < 0.5) return 'low';
  if (ratio < 1) return 'building';
  return 'met';
}

/// Honest phrasings per band — 3 warm variants each, as i18n keys. Slot 0 is
/// the original wording (so `seed = 0` reproduces the legacy output). ED rule
/// (enforced on the locale strings by the unit test): every variant is framed
/// as a habit to grow / satiety / muscle — never a cap, never "too much",
/// never calories.
export const PROTEIN_COPY: Record<ProteinBand, readonly string[]> = {
  unset: ['insights.protein.unset0', 'insights.protein.unset1', 'insights.protein.unset2'],
  none: ['insights.protein.none0', 'insights.protein.none1', 'insights.protein.none2'],
  low: ['insights.protein.low0', 'insights.protein.low1', 'insights.protein.low2'],
  building: [
    'insights.protein.building0',
    'insights.protein.building1',
    'insights.protein.building2',
  ],
  met: ['insights.protein.met0', 'insights.protein.met1', 'insights.protein.met2'],
};

/// One honest sentence about what today's protein does for the body, framed
/// against the personal `targetG` (a habit to grow, never a cap) — returned as
/// an i18n key, render with t(). `seed` lets a caller rotate phrasings
/// deterministically (stable per meal/day); the default reproduces the legacy
/// first variant.
export function proteinInsight(proteinG: number, targetG: number, seed = 0): string {
  return pickVariant(PROTEIN_COPY[proteinBand(proteinG, targetG)], seed);
}
