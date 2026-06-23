import { describe, expect, it, jest } from '@jest/globals';

import {
  diaryInsight,
  RECURRING_DISTORTION_MIN,
  type DiaryInsightEntry,
} from '@/lib/core/insights/diaryInsight';

/// A blank entry; override only the fields a case cares about.
function entry(over: Partial<DiaryInsightEntry> = {}): DiaryInsightEntry {
  return {
    situation: '',
    thoughts: '',
    emotions: [],
    reframe: '',
    mood: null,
    distortions: [],
    ...over,
  };
}

describe('diaryInsight', () => {
  it('returns null on an empty diary', () => {
    expect(diaryInsight([])).toBeNull();
  });

  it('says nothing for a healthy, reframed entry with no recurring pattern', () => {
    const entries = [
      entry({ situation: 'Прошла встреча', thoughts: 'Нормально', reframe: 'Я справился', mood: 7 }),
      entry({ situation: 'Прогулка', reframe: 'Стало легче', mood: 8 }),
    ];
    expect(diaryInsight(entries)).toBeNull();
  });

  it('flags a recurring distortion once it hits the threshold', () => {
    const entries = Array.from({ length: RECURRING_DISTORTION_MIN }, () =>
      entry({ situation: 's', reframe: 'r', distortions: ['catastrophizing'] }),
    );
    expect(diaryInsight(entries)).toEqual({
      kind: 'recurring_distortion',
      distortion: 'catastrophizing',
      count: RECURRING_DISTORTION_MIN,
    });
  });

  it('does not flag a distortion below the threshold', () => {
    const entries = [
      entry({ situation: 's', reframe: 'r', distortions: ['shoulds'] }),
      entry({ situation: 's', reframe: 'r', distortions: ['shoulds'] }),
    ];
    expect(diaryInsight(entries)).toBeNull();
  });

  it('nudges gently when several recent entries carry very intense emotions', () => {
    const entries = [
      entry({ situation: 's', reframe: 'r', emotions: [{ name: 'тревога', intensity: 90 }] }),
      entry({ situation: 's', reframe: 'r', emotions: [{ name: 'злость', intensity: 85 }] }),
    ];
    expect(diaryInsight(entries)).toEqual({ kind: 'high_intensity_emotion' });
  });

  it('invites a reframe when the newest entry has content but no reframe', () => {
    const entries = [entry({ situation: 'Тяжёлый день', thoughts: 'Всё плохо', reframe: '' })];
    expect(diaryInsight(entries)).toEqual({ kind: 'missing_reframe' });
  });

  // ---- crisis safety ------------------------------------------------------

  it('returns supportive copy for a self-harm signal (ru) and lets it win', () => {
    const entries = [
      // also tags a distortion + high intensity: crisis must still take priority
      entry({
        situation: 'Не хочу жить',
        thoughts: 'устал',
        emotions: [{ name: 'отчаяние', intensity: 95 }],
        distortions: ['catastrophizing'],
      }),
      entry({ distortions: ['catastrophizing'] }),
      entry({ distortions: ['catastrophizing'] }),
    ];
    expect(diaryInsight(entries)).toEqual({ kind: 'crisis_support' });
  });

  it('detects an English self-harm signal too', () => {
    const entries = [entry({ thoughts: 'I want to die', situation: '' })];
    expect(diaryInsight(entries)).toEqual({ kind: 'crisis_support' });
  });

  // ---- on-device guarantee ------------------------------------------------

  it('makes NO network call (special-category data never leaves the device)', () => {
    const fetchSpy = jest.fn();
    const original = (globalThis as { fetch?: unknown }).fetch;
    (globalThis as { fetch?: unknown }).fetch = fetchSpy;
    try {
      diaryInsight([
        entry({ situation: 'Не хочу жить' }),
        entry({ distortions: ['catastrophizing'], emotions: [{ name: 'x', intensity: 99 }] }),
        entry({ situation: 's', reframe: '' }),
      ]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as { fetch?: unknown }).fetch = original;
    }
  });
});
