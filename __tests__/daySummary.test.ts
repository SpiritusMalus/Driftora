import { describe, expect, it } from '@jest/globals';

import { daySummary } from '@/lib/core/insights/daySummary';

describe('daySummary', () => {
  it('is the calm empty state with nothing logged yet', () => {
    expect(daySummary({ steps: null, mood: null, hasWinToday: false })).toEqual({
      key: 'empty',
      steps: undefined,
      mood: undefined,
    });
  });

  it('treats a synced zero-step day as "no walk yet", not a steps summary', () => {
    expect(daySummary({ steps: 0, mood: null, hasWinToday: false }).key).toBe('empty');
  });

  it('picks single-signal templates', () => {
    expect(daySummary({ steps: 4200, mood: null, hasWinToday: false })).toMatchObject({
      key: 'steps',
      steps: 4200,
    });
    expect(daySummary({ steps: null, mood: 7, hasWinToday: false })).toMatchObject({
      key: 'mood',
      mood: 7,
    });
    expect(daySummary({ steps: null, mood: null, hasWinToday: true }).key).toBe('win');
  });

  it('picks the right combined template for each pair', () => {
    expect(daySummary({ steps: 5000, mood: 6, hasWinToday: false }).key).toBe('stepsMood');
    expect(daySummary({ steps: 5000, mood: null, hasWinToday: true }).key).toBe('stepsWin');
    expect(daySummary({ steps: null, mood: 6, hasWinToday: true }).key).toBe('moodWin');
  });

  it('uses the full template when everything is present', () => {
    expect(daySummary({ steps: 8000, mood: 8, hasWinToday: true })).toEqual({
      key: 'stepsMoodWin',
      steps: 8000,
      mood: 8,
    });
  });

  it('carries a mood of 0 (a valid low reading), not dropped as falsy', () => {
    expect(daySummary({ steps: null, mood: 0, hasWinToday: false })).toMatchObject({
      key: 'mood',
      mood: 0,
    });
  });
});
