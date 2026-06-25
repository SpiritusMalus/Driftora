import { describe, expect, it } from '@jest/globals';

import {
  daySummary,
  daysSince,
  RETURNING_AFTER_DAYS,
  RETURNING_KEYS,
} from '@/lib/core/insights/daySummary';
import { en } from '@/lib/i18n/locales/en';
import { ru } from '@/lib/i18n/locales/ru';

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

describe('daysSince', () => {
  it('returns null when there is no prior activity', () => {
    expect(daysSince(null)).toBeNull();
  });

  it('counts whole calendar days, ignoring clock time within a day', () => {
    const now = new Date(2026, 5, 24, 1, 0); // 01:00 local
    expect(daysSince(new Date(2026, 5, 24, 23, 0), now)).toBe(0); // same day, later clock
    expect(daysSince(new Date(2026, 5, 23, 22, 0), now)).toBe(1); // yesterday
    expect(daysSince(new Date(2026, 5, 21, 5, 0), now)).toBe(3);
  });

  it('never goes negative for a future timestamp', () => {
    const now = new Date(2026, 5, 24);
    expect(daysSince(new Date(2026, 5, 27), now)).toBe(0);
  });
});

describe('daySummary forgiving re-engagement (B3)', () => {
  const emptyAway = (gap: number | null) =>
    daySummary({ steps: null, mood: null, hasWinToday: false, daysSinceLastActivity: gap });

  it('turns the empty state into a welcome-back variant after a real gap', () => {
    expect(RETURNING_KEYS).toContain(emptyAway(RETURNING_AFTER_DAYS).key);
    expect(RETURNING_KEYS).toContain(emptyAway(10).key);
  });

  it('stays the calm empty state for a 1-day gap (not a return)', () => {
    expect(emptyAway(1).key).toBe('empty');
  });

  it('stays empty when the gap is unknown or there is no history', () => {
    expect(emptyAway(null).key).toBe('empty');
    expect(daySummary({ steps: null, mood: null, hasWinToday: false }).key).toBe('empty');
  });

  it('never overrides a day that already has activity, however long the gap', () => {
    expect(
      daySummary({ steps: 5000, mood: null, hasWinToday: false, daysSinceLastActivity: 30 }).key,
    ).toBe('steps');
    expect(
      daySummary({ steps: null, mood: 6, hasWinToday: true, daysSinceLastActivity: 30 }).key,
    ).toBe('moodWin');
  });

  it('picks the welcome-back variant deterministically by seed', () => {
    const facts = { steps: null, mood: null, hasWinToday: false, daysSinceLastActivity: 5 };
    expect(daySummary(facts, 7).key).toBe(daySummary(facts, 7).key);
    expect(daySummary(facts, 0).key).toBe(RETURNING_KEYS[0]); // seed 0 = legacy variant
  });

  it('has ru + en copy for every variant, with zero shame markers', () => {
    const shame = /(пропуст|давно не виде|забыл|прогул|сорвал|miss(ed)?\b|skipp?ed|streak lost|fail)/i;
    const ruDS = ru.home.daySummary as Record<string, string>;
    const enDS = en.home.daySummary as Record<string, string>;
    for (const k of RETURNING_KEYS) {
      expect(typeof ruDS[k]).toBe('string');
      expect(typeof enDS[k]).toBe('string');
      expect(ruDS[k]).not.toMatch(shame);
      expect(enDS[k]).not.toMatch(shame);
    }
  });
});
