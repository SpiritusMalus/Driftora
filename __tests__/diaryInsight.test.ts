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

  it('does not treat a basic monitoring record without a reframe as unfinished', () => {
    const entries = [entry({ situation: 'Тяжёлый день', thoughts: 'Всё плохо', reframe: '' })];
    expect(diaryInsight(entries)).toBeNull();
  });

  it.each([
    { evidenceFor: 'Одна ошибка была' },
    { evidenceAgainst: 'Остальное получилось' },
  ])('offers further thought work after explicit evidence %j', (evidence) => {
    const entries = [entry({ situation: 'Встреча', thoughts: 'Я всё провалил', ...evidence })];
    expect(diaryInsight(entries)).toEqual({ kind: 'missing_reframe' });
  });

  it('ignores blank evidence and a confidence rating alone', () => {
    const confidenceOnly = {
      ...entry({ situation: 'Снег', thoughts: 'Буду любоваться', evidenceFor: '  ', evidenceAgainst: '\n' }),
      thoughtBelief: 100,
    };
    expect(diaryInsight([confidenceOnly])).toBeNull();
  });

  it('does not require a reframe after personal meanings and self-description', () => {
    const meaningOnly = {
      ...entry({ situation: 'Снег', thoughts: 'Буду любоваться' }),
      meanings: ['Шанс испытать радость', 'Безмятежность'],
      coreBelief: 'Я умею радоваться',
    };
    expect(diaryInsight([meaningOnly])).toBeNull();
  });

  it('does not carry an older evidence invitation into the newest basic record', () => {
    expect(diaryInsight([
      entry({ situation: 'Прогулка', thoughts: 'Свежий воздух' }),
      entry({ situation: 'Встреча', evidenceFor: 'Одна ошибка была' }),
    ])).toBeNull();
  });

  it('does not invite another reframe when the evidence already has a balanced view', () => {
    expect(diaryInsight([entry({
      situation: 'Встреча', evidenceFor: 'Одна ошибка была', reframe: 'Ошибка не отменяет сделанного',
    })])).toBeNull();
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
