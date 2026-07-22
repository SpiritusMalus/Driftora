import { describe, expect, it } from '@jest/globals';

import {
  clipWindows,
  mergedDayWindows,
  mergeWindows,
  subtractWindows,
} from '@/lib/core/services/workoutWindows';

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

describe('subtractWindows', () => {
  it('returns the whole window when nothing is claimed', () => {
    expect(subtractWindows(w(10, 20), [])).toEqual([w(10, 20)]);
  });

  it('trims a leading and a trailing overlap', () => {
    expect(subtractWindows(w(10, 20), [w(5, 12)])).toEqual([w(12, 20)]);
    expect(subtractWindows(w(10, 20), [w(18, 25)])).toEqual([w(10, 18)]);
  });

  it('splits into two pieces around a claim in the middle', () => {
    expect(subtractWindows(w(10, 30), [w(15, 20)])).toEqual([w(10, 15), w(20, 30)]);
  });

  it('a fully covered window earns nothing', () => {
    expect(subtractWindows(w(10, 20), [w(0, 100)])).toEqual([]);
    expect(subtractWindows(w(10, 20), [w(10, 20)])).toEqual([]);
  });

  it('ignores claims that do not touch the window', () => {
    expect(subtractWindows(w(10, 20), [w(0, 5), w(30, 40)])).toEqual([w(10, 20)]);
  });

  it('handles unsorted and overlapping claims (it merges them first)', () => {
    expect(subtractWindows(w(0, 100), [w(60, 70), w(10, 20), w(15, 25)])).toEqual([
      w(0, 10),
      w(25, 60),
      w(70, 100),
    ]);
  });

  it('rejects an invalid window rather than inventing a stretch', () => {
    expect(subtractWindows(w(20, 10), [])).toEqual([]);
    expect(subtractWindows(w(10, 10), [])).toEqual([]);
    expect(subtractWindows(w(NaN, 10), [])).toEqual([]);
  });
});
