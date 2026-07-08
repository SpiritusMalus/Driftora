import { describe, expect, it } from '@jest/globals';

import { encodeMicros, sumMicroRows } from '@/lib/core/db/food';
import { nutrientDetailRows } from '@/lib/core/insights/nutrientDetail';
import type { NutrientValues } from '@/lib/core/services/foodParser';
import { scaleToGrams, sumNutrients } from '@/lib/core/services/mealDraft';

const per100 = (over: Partial<NutrientValues> = {}): NutrientValues => ({
  kcal: 100,
  prot: 5,
  fat: 2,
  carb: 10,
  minerals: {},
  ...over,
});

describe('scaleToGrams carries vitamins', () => {
  it('scales present vitamins by grams/100 (2 dp) and leaves absent ones out', () => {
    const scaled = scaleToGrams(per100({ vitamins: { c: 90, b12: 2.4 } }), 200);
    expect(scaled.vitamins).toEqual({ c: 180, b12: 4.8 });
    // No vitamins block at all when the source had none.
    expect(scaleToGrams(per100(), 200).vitamins).toBeUndefined();
  });

  it('keeps a small real amount instead of rounding it to a fake zero', () => {
    // 0.08 mg thiamin over 50 g → 0.04 mg, still non-zero at 2 dp.
    const scaled = scaleToGrams(per100({ vitamins: { b1: 0.08 } }), 50);
    expect(scaled.vitamins?.b1).toBe(0.04);
  });
});

describe('sumNutrients sums vitamins across items', () => {
  it('adds present vitamins, omits the block when no item had any', () => {
    const summed = sumNutrients([
      { scaled: per100({ vitamins: { c: 30, a: 100 } }) },
      { scaled: per100({ vitamins: { c: 12 } }) },
      { scaled: per100() },
    ]);
    expect(summed.vitamins).toEqual({ c: 42, a: 100 });
    expect(sumNutrients([{ scaled: per100() }]).vitamins).toBeUndefined();
  });
});

describe('encodeMicros / sumMicroRows (daily roll-up)', () => {
  it('encodes only non-empty micro blocks, null when there is nothing', () => {
    expect(encodeMicros(per100())).toBeNull();
    const json = encodeMicros(per100({ minerals: { ca: 100 }, vitamins: { c: 20 } }));
    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toEqual({ minerals: { ca: 100 }, vitamins: { c: 20 } });
  });

  it('sums the day and reports honest coverage (data vs total meals)', () => {
    const totals = sumMicroRows([
      { micros: JSON.stringify({ minerals: { ca: 100, fe: 5 }, vitamins: { c: 20 } }) },
      { micros: JSON.stringify({ minerals: { ca: 50 }, vitamins: { c: 10, b12: 1 } }) },
      { micros: null }, // a meal whose foods carried no micro data
    ]);
    expect(totals.minerals).toEqual({ ca: 150, fe: 5 });
    expect(totals.vitamins).toEqual({ c: 30, b12: 1 });
    expect(totals.entriesWithData).toBe(2);
    expect(totals.entriesTotal).toBe(3);
  });

  it('ignores malformed or unknown-key JSON instead of trusting it', () => {
    const totals = sumMicroRows([
      { micros: 'not json' },
      { micros: JSON.stringify({ minerals: { bogus: 999 }, vitamins: { zzz: 5 } }) },
    ]);
    expect(totals.minerals).toEqual({});
    expect(totals.vitamins).toEqual({});
    expect(totals.entriesWithData).toBe(0);
  });
});

describe('nutrientDetailRows includes vitamins', () => {
  it('emits vitamin rows with the right units after the minerals', () => {
    const rows = nutrientDetailRows(per100({ minerals: { ca: 120 }, vitamins: { a: 900, c: 90, b1: 1.2 } }));
    expect(rows).toContainEqual({ key: 'ca', value: 120, unit: 'mg' });
    expect(rows).toContainEqual({ key: 'vitA', value: 900, unit: 'mcg' });
    expect(rows).toContainEqual({ key: 'vitC', value: 90, unit: 'mg' });
    expect(rows).toContainEqual({ key: 'vitB1', value: 1.2, unit: 'mg' });
    // A vitamin at 0 is noise, not shown.
    expect(nutrientDetailRows(per100({ vitamins: { c: 0 } })).some((r) => r.key === 'vitC')).toBe(false);
  });
});
