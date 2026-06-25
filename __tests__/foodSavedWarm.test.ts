import { describe, expect, it } from '@jest/globals';

import { pickVariant } from '@/lib/core/insights/variant';
import { en } from '@/lib/i18n/locales/en';
import { ru } from '@/lib/i18n/locales/ru';

/**
 * A2 — warm post-save acknowledgment. The food save now shows a brief, rotating
 * relatedness line (SDT) instead of a bare checkmark. This suite guards the
 * copy: it exists in both languages and is ED-safe — never a calorie, limit,
 * weight, or "good/bad food" framing.
 */

const KEYS = ['savedWarm1', 'savedWarm2', 'savedWarm3', 'savedWarm4'] as const;

const ruFood = ru.food as unknown as Record<string, string>;
const enFood = en.food as unknown as Record<string, string>;

describe('food.savedWarm acknowledgment (A2)', () => {
  it('has 3+ variants in both languages', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(3);
    for (const k of KEYS) {
      expect(typeof ruFood[k]).toBe('string');
      expect(typeof enFood[k]).toBe('string');
      expect(ruFood[k].length).toBeGreaterThan(0);
      expect(enFood[k].length).toBeGreaterThan(0);
    }
  });

  it('is ED-safe: no calories, limits, weight, or good/bad-food framing', () => {
    const unsafe =
      /(калори|ккал|лимит|вес\b|похуд|грамм|норм[аы]|нельзя|kcal|calorie|limit|weight|grams?|good food|bad food)/i;
    for (const k of KEYS) {
      expect(ruFood[k]).not.toMatch(unsafe);
      expect(enFood[k]).not.toMatch(unsafe);
    }
  });

  it('rotates deterministically across saves', () => {
    const ruVariants = KEYS.map((k) => ruFood[k]);
    expect(pickVariant(ruVariants, 0)).toBe(ruVariants[0]);
    expect(pickVariant(ruVariants, 5)).toBe(pickVariant(ruVariants, 5));
    // consecutive seeds give different lines (the per-save rotation)
    expect(pickVariant(ruVariants, 0)).not.toBe(pickVariant(ruVariants, 1));
  });
});
