import { describe, expect, it } from '@jest/globals';

import {
  BASELINE_ABS_FLOOR,
  BASELINE_TOLERANCE,
  MIN_BASELINE_DAYS,
  personalBaseline,
} from '@/lib/core/insights/baseline';

/// A window of `n` days all equal to `v` — a steady personal normal.
function steady(n: number, v: number): number[] {
  return Array.from({ length: n }, () => v);
}

describe('personalBaseline', () => {
  it('is forming until MIN_BASELINE_DAYS of prior data exist', () => {
    const r = personalBaseline(steady(MIN_BASELINE_DAYS - 1, 6000), 6000);
    expect(r.kind).toBe('forming');
    expect(r.baseline).toBe(0); // never claims a number while forming
    expect(r.observedDays).toBe(MIN_BASELINE_DAYS - 1);
    expect(r.today).toBe(6000);
  });

  it('crosses out of forming exactly at MIN_BASELINE_DAYS', () => {
    expect(personalBaseline(steady(MIN_BASELINE_DAYS, 6000), 6000).kind).toBe('typical');
  });

  it('calls a within-band day typical (not a miss)', () => {
    const recent = steady(12, 6000);
    // +10% is inside the ±15% tolerance.
    expect(personalBaseline(recent, 6600).kind).toBe('typical');
    expect(personalBaseline(recent, 5400).kind).toBe('typical');
  });

  it('flags above only outside the band', () => {
    const recent = steady(12, 6000);
    const band = 6000 * BASELINE_TOLERANCE; // 900 > abs floor
    expect(personalBaseline(recent, 6000 + band + 1).kind).toBe('above');
    expect(personalBaseline(recent, 6000 + band).kind).toBe('typical'); // boundary = typical
  });

  it('flags below only outside the band, neutrally', () => {
    const recent = steady(12, 6000);
    const band = 6000 * BASELINE_TOLERANCE;
    expect(personalBaseline(recent, 6000 - band - 1).kind).toBe('below');
    expect(personalBaseline(recent, 6000 - band).kind).toBe('typical');
  });

  it('uses the median, not the mean (one outlier day must not move it)', () => {
    // 11 days at 6000 + one huge 60000 day. mean ≈ 10500 (would call 6000 "below");
    // median stays 6000 so today=6000 is typical.
    const recent = [...steady(11, 6000), 60000];
    const r = personalBaseline(recent, 6000);
    expect(r.baseline).toBe(6000);
    expect(r.kind).toBe('typical');
  });

  it('keeps a near-zero baseline stable via the absolute floor', () => {
    // Median 0 → relative band is 0; the absolute floor keeps small days typical.
    const recent = steady(12, 0);
    expect(BASELINE_ABS_FLOOR).toBeGreaterThan(0);
    expect(personalBaseline(recent, BASELINE_ABS_FLOOR).kind).toBe('typical');
    expect(personalBaseline(recent, BASELINE_ABS_FLOOR + 1).kind).toBe('above');
  });

  it('handles empty / all-zero / today=0 without throwing', () => {
    expect(personalBaseline([], 5000).kind).toBe('forming');
    expect(personalBaseline(steady(12, 0), 0).kind).toBe('typical');
    const lowDay = personalBaseline(steady(12, 6000), 0);
    expect(lowDay.kind).toBe('below'); // a real zero-movement day reads as quieter
  });
});
