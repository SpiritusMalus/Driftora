import { describe, expect, it } from '@jest/globals';

import { encodeMicros, microDonor, sumMicroRows } from '@/lib/core/db/food';
import { dailyMicroNorms } from '@/lib/core/insights/microNutrients';
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

/// The owner-fright scenario (2026-07-21): «A 686% · B12 1053% · железо 263%»
/// turned out to be one mismatched DB row (liver instead of a plain гуляш). The
/// day sum must stay attributable to the meal behind an outlier.
describe('micro donor attribution (outlier → its meal)', () => {
  const liverish = {
    id: 1,
    rawText: 'гуляш из говядины',
    micros: JSON.stringify({ minerals: { fe: 18 }, vitamins: { a: 6000 } }),
  };
  const porridge = {
    id: 2,
    rawText: 'каша',
    micros: JSON.stringify({ minerals: { fe: 3 }, vitamins: { a: 200 } }),
  };
  const norm = (key: string) => dailyMicroNorms('male').find((r) => r.key === key)!;

  it('keeps the largest per-entry contribution per nutrient, sums intact', () => {
    const totals = sumMicroRows([liverish, porridge]);
    expect(totals.vitaminsTop.a).toEqual({ entryId: 1, rawText: 'гуляш из говядины', value: 6000 });
    expect(totals.mineralsTop.fe).toEqual({ entryId: 1, rawText: 'гуляш из говядины', value: 18 });
    expect(totals.vitamins.a).toBe(6200);
    expect(totals.minerals.fe).toBe(21);
  });

  it('calls out the donor past both gates: sum ≥150% of norm AND >½ from one entry', () => {
    const totals = sumMicroRows([liverish, porridge]);
    // Vitamin A: 6200/900 ≈ 689 % of the norm, ~97 % of it from the гуляш.
    const a = microDonor(totals, norm('a'));
    expect(a?.entryId).toBe(1);
    expect(a?.rawText).toBe('гуляш из говядины');
    expect(a!.share).toBeGreaterThan(0.9);
    // Iron: 21/8 ≈ 262 %, 18/21 ≈ 86 % from the same row → called out too.
    expect(microDonor(totals, norm('fe'))?.entryId).toBe(1);
  });

  it('stays silent on a normal day (sum under 150% of the norm)', () => {
    const totals = sumMicroRows([
      { id: 1, rawText: 'апельсин', micros: JSON.stringify({ vitamins: { c: 60 } }) },
      { id: 2, rawText: 'киви', micros: JSON.stringify({ vitamins: { c: 50 } }) },
    ]);
    // 110/90 ≈ 122 % — a dominant share alone must not fire the call-out.
    expect(microDonor(totals, norm('c'))).toBeNull();
  });

  it('stays silent when no single entry dominates the anomalous sum', () => {
    const totals = sumMicroRows([
      { id: 1, rawText: 'морковь', micros: JSON.stringify({ vitamins: { a: 700 } }) },
      { id: 2, rawText: 'тыква', micros: JSON.stringify({ vitamins: { a: 700 } }) },
    ]);
    // 1400/900 ≈ 155 %, but an exact 50/50 split — «почти всё» would be a lie.
    expect(microDonor(totals, norm('a'))).toBeNull();
  });

  it('yields no donor for rows without ids (legacy callers keep plain sums)', () => {
    const totals = sumMicroRows([{ micros: JSON.stringify({ vitamins: { a: 6000 } }) }]);
    expect(totals.vitamins.a).toBe(6000);
    expect(totals.vitaminsTop.a).toBeUndefined();
    expect(microDonor(totals, norm('a'))).toBeNull();
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
