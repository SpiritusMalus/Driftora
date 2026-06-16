import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { selfInitiatedLogDays } from '@/lib/core/db/activity';
import { gatherMoodStepDays } from '@/lib/core/db/bodyMind';
import { saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import { latestMood, listMoods, logMood } from '@/lib/core/db/mood';
import * as schema from '@/lib/core/db/schema';
import { upsertSteps } from '@/lib/core/db/steps';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function diaryDraft(mood: number): DiaryDraft {
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

describe('mood db', () => {
  it('logs check-ins and reads them newest-first + latest', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await logMood(db, 6, new Date(2026, 5, 15, 10));
    await logMood(db, 8, new Date(2026, 5, 16, 10));

    expect((await listMoods(db)).map((m) => m.value)).toEqual([8, 6]);
    expect((await latestMood(db))?.value).toBe(8);
    sqlite.close();
  });
});

describe('mood feeds Body↔Mind and activity', () => {
  it('averages a standalone mood with a diary mood on the same day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await upsertSteps(db, '2026-06-01', 5000);
    await saveDiaryEntry(db, diaryDraft(4), new Date(2026, 5, 1, 9));
    await logMood(db, 8, new Date(2026, 5, 1, 18));

    // (4 + 8) / 2 = 6 for the day.
    expect(await gatherMoodStepDays(db)).toEqual([{ day: '2026-06-01', steps: 5000, mood: 6 }]);
    sqlite.close();
  });

  it('lets standalone moods alone unlock the insight (no diary needed)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const days: [string, number, number][] = [
      ['2026-06-01', 3000, 4],
      ['2026-06-02', 3500, 5],
      ['2026-06-03', 4000, 4],
    ];
    for (const [day, steps, mood] of days) {
      await upsertSteps(db, day, steps);
      await logMood(db, mood, new Date(2026, 5, Number(day.slice(-2)), 12));
    }

    const points = (await gatherMoodStepDays(db)).sort((a, b) => a.day.localeCompare(b.day));
    expect(points).toEqual([
      { day: '2026-06-01', steps: 3000, mood: 4 },
      { day: '2026-06-02', steps: 3500, mood: 5 },
      { day: '2026-06-03', steps: 4000, mood: 4 },
    ]);
    sqlite.close();
  });

  it('counts a mood check-in as a self-initiated log day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await logMood(db, 7, new Date(2026, 5, 20, 9));
    expect([...(await selfInitiatedLogDays(db))]).toEqual(['2026-06-20']);
    sqlite.close();
  });
});
