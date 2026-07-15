import { describe, expect, it } from '@jest/globals';

import { asleepMinutes } from '@/lib/core/services/sleepSamples';

/// Regression for the iOS sleep double-count bug: HealthKit returns OVERLAPPING
/// samples (an `InBed` envelope + inner `Asleep`/stage segments, one set per
/// source). Naively summing every sample's duration inflated a night ~1.5–2×.
/// `asleepMinutes` must count the real asleep union once.
describe('asleepMinutes (HealthKit sleep de-dup)', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m).toISOString();

  it('drops the InBed envelope and counts the Asleep segment once', () => {
    // InBed 23:00–06:30 (7.5h) fully contains Asleep 23:10–06:20 (7h10m = 430m).
    const samples = [
      { startDate: at(23, 0), endDate: at(30, 30), value: 'INBED' }, // 30:30 = 06:30 next day
      { startDate: at(23, 10), endDate: at(30, 20), value: 'ASLEEP' },
    ];
    expect(Math.round(asleepMinutes(samples))).toBe(430);
  });

  it('merges overlapping stage samples instead of adding them', () => {
    // CORE 00:00–02:00 and DEEP 01:30–03:00 overlap → union 00:00–03:00 = 180m,
    // not 120 + 90 = 210.
    const samples = [
      { startDate: at(0, 0), endDate: at(2, 0), value: 'CORE' },
      { startDate: at(1, 30), endDate: at(3, 0), value: 'DEEP' },
    ];
    expect(Math.round(asleepMinutes(samples))).toBe(180);
  });

  it('de-duplicates the same night reported by two sources', () => {
    // iPhone and Watch both report ASLEEP 01:00–05:00 (240m) → 240, not 480.
    const samples = [
      { startDate: at(1, 0), endDate: at(5, 0), value: 'ASLEEP' },
      { startDate: at(1, 0), endDate: at(5, 0), value: 'ASLEEP' },
    ];
    expect(Math.round(asleepMinutes(samples))).toBe(240);
  });

  it('excludes Awake segments', () => {
    const samples = [
      { startDate: at(0, 0), endDate: at(6, 0), value: 'ASLEEP' }, // 360m
      { startDate: at(2, 0), endDate: at(2, 30), value: 'AWAKE' }, // ignored
    ];
    expect(Math.round(asleepMinutes(samples))).toBe(360);
  });

  it('falls back to merging when no value is present (older payloads)', () => {
    const samples = [
      { startDate: at(2, 0), endDate: at(9, 0) }, // 7h = 420m, no value
      { startDate: at(4, 0), endDate: at(6, 0) }, // overlaps inside → not added twice
    ];
    expect(Math.round(asleepMinutes(samples))).toBe(420);
  });

  it('returns 0 for an empty list', () => {
    expect(asleepMinutes([])).toBe(0);
  });
});
