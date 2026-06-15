import { describe, expect, it } from '@jest/globals';

import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

const parser = new StubFoodParser();

describe('StubFoodParser', () => {
  it('parses the canonical example into items with macros', async () => {
    const r = await parser.parse('омлет из трёх яиц и кофе с молоком');
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    expect(r.kcal).toBeGreaterThan(0);
    const egg = r.items.find((i) => i.name.toLowerCase().includes('яйцо'));
    expect(egg).toBeDefined();
    // "трёх" → quantity 3 applied to the egg macros.
    expect(egg!.proteinG).toBeGreaterThan(15);
  });

  it('totals equal the sum of item macros', async () => {
    const r = await parser.parse('банан, рис, курица');
    const sum = r.items.reduce((a, i) => a + i.kcal, 0);
    expect(r.kcal).toBeCloseTo(Math.round(sum * 10) / 10, 1);
  });

  it('flags needsClarification on empty input', async () => {
    const r = await parser.parse('   ');
    expect(r.items).toHaveLength(0);
    expect(r.needsClarification).toBe(true);
    expect(r.clarifyQuestion).not.toBeNull();
  });

  it('falls back to a default estimate for unknown foods', async () => {
    const r = await parser.parse('инопланетная еда');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].kcal).toBeGreaterThan(0);
    expect(r.items[0].assumptions).toContain('заглушка');
  });
});
