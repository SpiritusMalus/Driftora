import { describe, expect, it } from '@jest/globals';

import { clipWindows, mergedDayWindows, mergeWindows } from '@/lib/core/services/workoutWindows';

const w = (start: number, end: number) => ({ start, end });

describe('mergeWindows', () => {
  it('keeps disjoint windows apart and drops invalid ones', () => {
    expect(mergeWindows([w(10, 20), w(30, 40), w(50, 50), w(NaN, 5)])).toEqual([
      w(10, 20),
      w(30, 40),
    ]);
  });

  it('merges overlapping, touching and nested windows into one', () => {
    // Watch auto-detect (10–40) + manual start (30–60) + a nested blip (12–15):
    // the union is one 10–60 stretch — summing per-window would double-count.
    expect(mergeWindows([w(30, 60), w(10, 40), w(12, 15)])).toEqual([w(10, 60)]);
    expect(mergeWindows([w(10, 20), w(20, 30)])).toEqual([w(10, 30)]); // touching
  });

  it('handles duplicates (same session reported twice)', () => {
    expect(mergeWindows([w(10, 20), w(10, 20)])).toEqual([w(10, 20)]);
  });
});

describe('clipWindows', () => {
  it('clips a midnight-crossing window to the day and drops fully-outside ones', () => {
    const dayStart = 1000;
    const dayEnd = 2000;
    expect(clipWindows([w(900, 1100), w(1900, 2100), w(100, 200), w(2100, 2200)], dayStart, dayEnd)).toEqual([
      w(1000, 1100), // started before midnight → only the inside stretch
      w(1900, 2000), // runs past the day's end → clipped
    ]);
  });
});

describe('mergedDayWindows', () => {
  it('clips then merges, so an overlap created by clipping still unifies', () => {
    expect(mergedDayWindows([w(900, 1500), w(1400, 1600)], 1000, 2000)).toEqual([w(1000, 1600)]);
  });

  it('returns empty for a day without sessions', () => {
    expect(mergedDayWindows([], 0, 1000)).toEqual([]);
  });
});
