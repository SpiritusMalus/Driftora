import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { bodyMindInsightFromDb, gatherMoodStepDays } from '@/lib/core/db/bodyMind';
import { saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { upsertSteps } from '@/lib/core/db/steps';
import { bodyMindInsight, type MoodStepDay } from '@/lib/core/insights/bodyMind';

// ---- pure insight ---------------------------------------------------------

const pt = (steps: number, mood: number): MoodStepDay => ({ day: `d${steps}`, steps, mood });

describe('bodyMindInsight', () => {
  it('says nothing until there are enough paired days', () => {
    const points = [pt(3000, 4), pt(4000, 5), pt(8000, 7), pt(8500, 8), pt(9000, 7)];
    expect(bodyMindInsight(points)).toEqual({ kind: 'insufficient', pairedDays: 5 });
  });

  it('reports a link when higher-step days have higher average mood', () => {
    const points = [
      pt(3000, 4),
      pt(3500, 5),
      pt(4000, 4),
      pt(8000, 7),
      pt(8500, 8),
      pt(9000, 7),
    ];
    expect(bodyMindInsight(points)).toEqual({
      kind: 'link',
      pairedDays: 6,
      direction: 'more_steps_better_mood',
      moodGap: 3,
      fewerStepsAvgMood: 4.3,
      moreStepsAvgMood: 7.3,
    });
  });

  it('reports the opposite direction honestly (more steps, lower mood)', () => {
    const points = [
      pt(3000, 7),
      pt(3500, 8),
      pt(4000, 7),
      pt(8000, 4),
      pt(8500, 5),
      pt(9000, 4),
    ];
    const result = bodyMindInsight(points);
    expect(result.kind).toBe('link');
    if (result.kind !== 'link') return;
    expect(result.direction).toBe('more_steps_worse_mood');
    expect(result.moodGap).toBe(3);
  });

  it('calls a tiny gap "no link" rather than dressing up noise', () => {
    const points = [
      pt(3000, 5),
      pt(3500, 5),
      pt(4000, 5),
      pt(8000, 5),
      pt(8500, 5),
      pt(9000, 6),
    ];
    expect(bodyMindInsight(points)).toEqual({ kind: 'no_link', pairedDays: 6 });
  });

  it('reports no link when steps do not separate (all tie at the median)', () => {
    const points = [pt(5000, 3), pt(5000, 9), pt(5000, 4), pt(5000, 8), pt(5000, 5), pt(5000, 7)];
    expect(bodyMindInsight(points)).toEqual({ kind: 'no_link', pairedDays: 6 });
  });
});

// ---- db gathering ---------------------------------------------------------

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(mood: number | null): DiaryDraft {
  return {
    situation: '',
    thoughts: '',
    emotions: [],
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: '',
    mood,
  };
}

/// Noon on a June 2026 day, in local time, so its `dayKey` is '2026-06-DD'.
const noon = (d: number) => new Date(2026, 5, d, 12);

describe('gatherMoodStepDays', () => {
  it('pairs per local day, averaging moods and dropping unpaired/null days', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    for (const [day, steps] of [
      ['2026-06-01', 3000],
      ['2026-06-02', 3500],
      ['2026-06-03', 4000],
      ['2026-06-04', 8000],
      ['2026-06-05', 8500],
      ['2026-06-06', 9000],
      ['2026-06-08', 9000], // steps but no diary -> dropped
    ] as const) {
      await upsertSteps(db, day, steps);
    }

    await saveDiaryEntry(db, draft(4), noon(1)); // 06-01 averages (4+6)/2 = 5
    await saveDiaryEntry(db, draft(6), noon(1));
    await saveDiaryEntry(db, draft(5), noon(2)); // 06-02 with a stray null -> 5
    await saveDiaryEntry(db, draft(null), noon(2));
    await saveDiaryEntry(db, draft(4), noon(3));
    await saveDiaryEntry(db, draft(7), noon(4));
    await saveDiaryEntry(db, draft(8), noon(5));
    await saveDiaryEntry(db, draft(7), noon(6));
    await saveDiaryEntry(db, draft(9), noon(7)); // diary but no steps -> dropped

    const points = (await gatherMoodStepDays(db)).sort((a, b) => a.day.localeCompare(b.day));
    expect(points).toEqual([
      { day: '2026-06-01', steps: 3000, mood: 5 },
      { day: '2026-06-02', steps: 3500, mood: 5 },
      { day: '2026-06-03', steps: 4000, mood: 4 },
      { day: '2026-06-04', steps: 8000, mood: 7 },
      { day: '2026-06-05', steps: 8500, mood: 8 },
      { day: '2026-06-06', steps: 9000, mood: 7 },
    ]);
    sqlite.close();
  });

  it('feeds the pure insight end-to-end', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const days: [string, number, number][] = [
      ['2026-06-01', 3000, 5],
      ['2026-06-02', 3500, 5],
      ['2026-06-03', 4000, 4],
      ['2026-06-04', 8000, 7],
      ['2026-06-05', 8500, 8],
      ['2026-06-06', 9000, 7],
    ];
    let d = 1;
    for (const [day, steps, mood] of days) {
      await upsertSteps(db, day, steps);
      await saveDiaryEntry(db, draft(mood), noon(d++));
    }

    expect(await bodyMindInsightFromDb(db)).toEqual({
      kind: 'link',
      pairedDays: 6,
      direction: 'more_steps_better_mood',
      moodGap: 2.7,
      fewerStepsAvgMood: 4.7,
      moreStepsAvgMood: 7.3,
    });
    sqlite.close();
  });

  it('stays "insufficient" with only a few paired days', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    for (const d of [1, 2, 3]) {
      await upsertSteps(db, `2026-06-0${d}`, d * 1000);
      await saveDiaryEntry(db, draft(5), noon(d));
    }

    expect(await bodyMindInsightFromDb(db)).toEqual({ kind: 'insufficient', pairedDays: 3 });
    sqlite.close();
  });
});
