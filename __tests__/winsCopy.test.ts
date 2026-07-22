import { describe, expect, it } from '@jest/globals';

import { pickVariant } from '@/lib/core/insights/variant';
import { en } from '@/lib/i18n/locales/en';
import { ru } from '@/lib/i18n/locales/ru';

/**
 * B2 — wins copy depth. The two auto-win messages each gained warm, specific
 * variants (the rest of the win copy is the user's own manual text). These are
 * i18n strings rotated in Home via `pickVariant`; this suite guards the copy
 * contract: zero-regression first element, the interpolation placeholder is
 * kept, ru/en stay in parity, and nothing shaming slips in.
 */

const STEP_KEYS = ['stepsGoal', 'stepsGoal2', 'stepsGoal3', 'stepsGoal4'] as const;
const PROTEIN_KEYS = ['proteinGoal', 'proteinGoal2', 'proteinGoal3', 'proteinGoal4'] as const;
/// The workout win joined later and carries NO placeholder on purpose — a «по
/// трекеру» session has kcal but no minutes, so any number in the copy would be
/// invented. Held to the same variety and no-shame bar as the other two.
const WORKOUT_KEYS = ['workout', 'workout2', 'workout3', 'workout4'] as const;

const ruAuto = ru.wins.auto as Record<string, string>;
const enAuto = en.wins.auto as Record<string, string>;

describe('wins auto-copy variants (B2)', () => {
  it('keeps the legacy wording as the first variant (zero regression)', () => {
    // pickVariant with seed 0 must reproduce the original single string.
    expect(pickVariant(STEP_KEYS.map((k) => ruAuto[k]), 0)).toBe(ruAuto.stepsGoal);
    expect(pickVariant(PROTEIN_KEYS.map((k) => ruAuto[k]), 0)).toBe(ruAuto.proteinGoal);
  });

  it('offers at least 3 variants per win type in both languages', () => {
    expect(STEP_KEYS.length).toBeGreaterThanOrEqual(3);
    expect(PROTEIN_KEYS.length).toBeGreaterThanOrEqual(3);
    expect(WORKOUT_KEYS.length).toBeGreaterThanOrEqual(3);
    for (const k of [...STEP_KEYS, ...PROTEIN_KEYS, ...WORKOUT_KEYS]) {
      expect(typeof ruAuto[k]).toBe('string');
      expect(typeof enAuto[k]).toBe('string');
    }
  });

  it('keeps the workout copy number-free (a tracker session has no minutes)', () => {
    for (const k of WORKOUT_KEYS) {
      expect(ruAuto[k]).not.toMatch(/\{\{\w+\}\}/);
      expect(enAuto[k]).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it('every variant keeps its interpolation placeholder', () => {
    for (const k of STEP_KEYS) {
      expect(ruAuto[k]).toContain('{{steps}}');
      expect(enAuto[k]).toContain('{{steps}}');
    }
    for (const k of PROTEIN_KEYS) {
      expect(ruAuto[k]).toContain('{{protein}}');
      expect(enAuto[k]).toContain('{{protein}}');
    }
  });

  it('never shames or frames the win as control', () => {
    const shame = /(нельзя|не забуд|должны|провал|fail|don'?t|must|should|limit|too much)/i;
    for (const k of [...STEP_KEYS, ...PROTEIN_KEYS, ...WORKOUT_KEYS]) {
      expect(ruAuto[k]).not.toMatch(shame);
      expect(enAuto[k]).not.toMatch(shame);
    }
  });

  it('picks deterministically by seed (stable per day)', () => {
    const ru4 = STEP_KEYS.map((k) => ruAuto[k]);
    expect(pickVariant(ru4, 42)).toBe(pickVariant(ru4, 42));
    expect(pickVariant(ru4, 1)).toBe(ru4[1]);
  });
});
