import { describe, expect, it } from '@jest/globals';

import { BASIC_MICROS, dailyMicroNorms } from '@/lib/core/insights/microNutrients';

describe('BASIC_MICROS table', () => {
  it('covers the basic vitamin + mineral set with plausible, well-formed entries', () => {
    const vitamins = BASIC_MICROS.filter((m) => m.group === 'vitamin').map((m) => m.key);
    const minerals = BASIC_MICROS.filter((m) => m.group === 'mineral').map((m) => m.key);
    expect(vitamins).toEqual(['a', 'd', 'e', 'c', 'b1', 'b2', 'b6', 'b9', 'b12']);
    expect(minerals).toEqual(['ca', 'fe', 'mg', 'zn', 'k', 'na', 'i']);

    for (const m of BASIC_MICROS) {
      expect(m.male).toBeGreaterThan(0);
      expect(m.female).toBeGreaterThan(0);
      expect(m.unit === 'mg' || m.unit === 'mcg').toBe(true);
    }
  });

  it('keys are unique (stable i18n / React keys)', () => {
    const keys = BASIC_MICROS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('dailyMicroNorms', () => {
  it('personalizes sex-split norms when sex is known (no dual column)', () => {
    const female = dailyMicroNorms('female');
    const fe = female.find((r) => r.key === 'fe')!;
    expect(fe.value).toBe(18); // iron RDA is much higher for women
    expect(fe.sexSplit).toBeNull();

    const male = dailyMicroNorms('male');
    expect(male.find((r) => r.key === 'fe')!.value).toBe(8);
    expect(male.find((r) => r.key === 'a')!.value).toBe(900);
  });

  it('shows both columns for sex-dependent norms when sex is unset', () => {
    const rows = dailyMicroNorms('');
    const fe = rows.find((r) => r.key === 'fe')!;
    expect(fe.sexSplit).toEqual({ male: 8, female: 18 });

    // A norm equal for both sexes never splits, even when sex is unknown.
    expect(rows.find((r) => r.key === 'ca')!.sexSplit).toBeNull();
    expect(rows.find((r) => r.key === 'd')!.sexSplit).toBeNull();
  });

  it('flags sodium as an adequate-intake with an upper limit', () => {
    const na = dailyMicroNorms('male').find((r) => r.key === 'na')!;
    expect(na.adequate).toBe(true);
    expect(na.limit).toBe(2300);
    // Potassium is adequate-intake too, but carries no upper limit here.
    const k = dailyMicroNorms('male').find((r) => r.key === 'k')!;
    expect(k.adequate).toBe(true);
    expect(k.limit).toBeUndefined();
  });

  it('leaves RDA-backed nutrients unflagged', () => {
    expect(dailyMicroNorms('female').find((r) => r.key === 'c')!.adequate).toBe(false);
  });
});
