import { describe, expect, it } from '@jest/globals';

import { encodeMicros, sumMicroRows } from '@/lib/core/db/food';
import type { NutrientValues } from '@/lib/core/services/foodParser';

/// Scaled totals for an entry — only the micro/fibre part matters here, so the
/// macros stay at zero.
const nv = (over: Partial<NutrientValues> = {}): NutrientValues => ({
  kcal: 0,
  prot: 0,
  fat: 0,
  carb: 0,
  minerals: {},
  ...over,
});

describe('fibre in the stored micro blob', () => {
  it('encodes fibre alongside minerals/vitamins', () => {
    const raw = encodeMicros(nv({ minerals: { k: 100 }, fiber: 4.2 }));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ minerals: { k: 100 }, fiber: 4.2 });
  });

  it('encodes a fibre-only entry (RU dishes carry no minerals)', () => {
    const raw = encodeMicros(nv({ fiber: 1.6 }));
    expect(JSON.parse(raw!)).toEqual({ fiber: 1.6 });
  });

  it('keeps a real 0 — "measured, none here" is information', () => {
    const raw = encodeMicros(nv({ fiber: 0 }));
    expect(JSON.parse(raw!)).toEqual({ fiber: 0 });
  });

  it('still returns null when there is no micro data at all', () => {
    expect(encodeMicros(nv())).toBeNull();
  });

  it('sums the day fibre across entries', () => {
    const rows = [
      { id: 1, rawText: 'борщ', micros: encodeMicros(nv({ fiber: 1.6 })) },
      { id: 2, rawText: 'винегрет', micros: encodeMicros(nv({ fiber: 2.2 })) },
      { id: 3, rawText: 'бульон', micros: encodeMicros(nv({ fiber: 0 })) },
      { id: 4, rawText: 'без данных', micros: null },
    ];
    expect(sumMicroRows(rows).fiberG).toBe(3.8);
  });

  it('a fibre-only entry does NOT inflate micronutrient coverage', () => {
    const rows = [
      { id: 1, rawText: 'борщ', micros: encodeMicros(nv({ fiber: 1.6 })) },
      { id: 2, rawText: 'курица', micros: encodeMicros(nv({ minerals: { k: 250 } })) },
    ];
    const totals = sumMicroRows(rows);
    expect(totals.fiberG).toBe(1.6);
    // only the mineral-carrying entry counts as "measured micros"
    expect(totals.entriesWithData).toBe(1);
    expect(totals.entriesTotal).toBe(2);
  });
});
