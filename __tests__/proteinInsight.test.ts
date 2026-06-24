import { describe, expect, it } from '@jest/globals';

import { PROTEIN_COPY, proteinBand, proteinInsight } from '@/lib/core/insights/proteinInsight';

describe('proteinBand', () => {
  it('treats a 0 target as "unset"', () => {
    expect(proteinBand(100, 0)).toBe('unset');
    expect(proteinBand(0, 0)).toBe('unset');
  });

  it('bands by ratio to the personal target', () => {
    expect(proteinBand(0, 120)).toBe('none');
    expect(proteinBand(40, 120)).toBe('low'); // 0.33
    expect(proteinBand(60, 120)).toBe('building'); // 0.50
    expect(proteinBand(119, 120)).toBe('building');
    expect(proteinBand(120, 120)).toBe('met');
    expect(proteinBand(200, 120)).toBe('met');
  });
});

describe('proteinInsight', () => {
  it('returns a supportive sentence for every band and never mentions calories', () => {
    const cases: [number, number][] = [
      [100, 0],
      [0, 120],
      [40, 120],
      [80, 120],
      [130, 120],
    ];
    for (const [p, target] of cases) {
      const sentence = proteinInsight(p, target);
      expect(sentence.length).toBeGreaterThan(0);
      // ED safeguard: protein copy must not turn into calorie pressure.
      expect(sentence.toLowerCase()).not.toContain('калор');
    }
  });

  it('seed 0 reproduces the legacy first variant for every band', () => {
    const probes: [number, number][] = [
      [100, 0], // unset
      [0, 120], // none
      [40, 120], // low
      [80, 120], // building
      [130, 120], // met
    ];
    for (const [p, target] of probes) {
      const band = proteinBand(p, target);
      expect(proteinInsight(p, target, 0)).toBe(PROTEIN_COPY[band][0]);
    }
  });

  it('returns a member of the band set for any seed, deterministically', () => {
    const probes: [number, number][] = [
      [100, 0],
      [0, 120],
      [40, 120],
      [80, 120],
      [130, 120],
    ];
    for (const [p, target] of probes) {
      const band = proteinBand(p, target);
      for (let seed = 0; seed < 9; seed++) {
        const out = proteinInsight(p, target, seed);
        expect(PROTEIN_COPY[band]).toContain(out);
        expect(proteinInsight(p, target, seed)).toBe(out); // determinism
      }
    }
  });

  it('keeps every variant ED-safe (no calories / cap / "too much" language)', () => {
    for (const variants of Object.values(PROTEIN_COPY)) {
      for (const v of variants) {
        const low = v.toLowerCase();
        expect(low).not.toContain('калор');
        expect(low).not.toContain('слишком');
        expect(low).not.toContain('лимит');
        expect(low).not.toContain('много белка');
      }
    }
  });
});
