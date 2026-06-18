import { describe, expect, it } from '@jest/globals';

import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

const parser = new StubFoodParser();

describe('StubFoodParser', () => {
  it('parses the canonical example into items with per-100g + scaled totals', async () => {
    const r = await parser.parse('омлет из трёх яиц и кофе с молоком', 'RU');
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    expect(r.totals.kcal).toBeGreaterThan(0);
    const egg = r.items.find((i) => i.name_ru.toLowerCase().includes('яйцо'));
    expect(egg).toBeDefined();
    // "трёх" → quantity 3 applied to the egg portion (3 × 50 g).
    expect(egg!.grams).toBe(150);
    // per-100g is the exact-ish table value; scaled reflects the 150 g portion.
    expect(egg!.scaled.prot).toBeGreaterThan(egg!.per100.prot);
  });

  it('is honest offline: estimated grams → approximate, source = estimate', async () => {
    const r = await parser.parse('банан', 'US');
    expect(r.approximate).toBe(true);
    expect(r.portion_state).toBe('estimated');
    expect(r.items[0].per100.source).toBe('estimate');
    expect(r.flags.has_estimate).toBe(true);
  });

  it('totals equal the sum of item scaled macros', async () => {
    const r = await parser.parse('банан, рис, курица', 'US');
    const sum = r.items.reduce((a, i) => a + i.scaled.kcal, 0);
    expect(r.totals.kcal).toBe(Math.round(sum));
  });

  it('returns an empty draft on empty input', async () => {
    const r = await parser.parse('   ', 'RU');
    expect(r.items).toHaveLength(0);
    expect(r.approximate).toBe(false);
  });

  it('falls back to a default estimate for unknown foods', async () => {
    const r = await parser.parse('инопланетная еда', 'RU');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].per100.source).toBe('estimate');
    expect(r.items[0].scaled.kcal).toBeGreaterThan(0);
  });
});
