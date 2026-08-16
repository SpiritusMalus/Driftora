import { describe, expect, it } from '@jest/globals';

import { varietyBand, varietyInsight } from '@/lib/core/insights/varietyInsight';
import i18n from '@/lib/i18n';

describe('varietyInsight (A5)', () => {
  it('bands distinct-item counts: none / some / varied', () => {
    expect(varietyBand(0)).toBe('none');
    expect(varietyBand(-3)).toBe('none'); // defensive
    expect(varietyBand(1)).toBe('some');
    expect(varietyBand(2)).toBe('some');
    expect(varietyBand(3)).toBe('varied');
    expect(varietyBand(9)).toBe('varied');
  });

  it('resolves to a non-empty sentence for every band (both locales)', () => {
    for (const n of [0, 1, 2, 3, 7]) {
      for (const lng of ['ru', 'en'] as const) {
        const s = String(i18n.t(varietyInsight(n), { lng }));
        expect(s.length).toBeGreaterThan(0);
        expect(s).not.toBe(varietyInsight(n)); // the key actually resolves
      }
    }
  });

  it('is ED-safe: never frames amounts, limits, or calories (both locales)', () => {
    const unsafe = /(калори|ккал|больше|меньше|лимит|норм[аы]|съешь|kcal|calorie|more|less|limit)/i;
    for (const n of [0, 1, 2, 3, 7]) {
      for (const lng of ['ru', 'en'] as const) {
        expect(String(i18n.t(varietyInsight(n), { lng }))).not.toMatch(unsafe);
      }
    }
  });

  it('is deterministic for a given count', () => {
    expect(varietyInsight(4)).toBe(varietyInsight(4));
  });
});
