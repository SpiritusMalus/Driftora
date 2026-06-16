import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  getDiaryEntry,
  listDistortionTagsSince,
  saveDiaryEntry,
  type DiaryDraft,
} from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { isDistortionKey, thinkingTrapOfWeek } from '@/lib/core/insights/distortions';

describe('thinkingTrapOfWeek', () => {
  it('returns null when nothing is tagged', () => {
    expect(thinkingTrapOfWeek([])).toBeNull();
    expect(thinkingTrapOfWeek([[], []])).toBeNull();
  });

  it('picks the most frequently tagged distortion', () => {
    expect(
      thinkingTrapOfWeek([
        ['catastrophizing'],
        ['catastrophizing', 'mind_reading'],
        ['mind_reading'],
        ['catastrophizing'],
      ]),
    ).toEqual({ key: 'catastrophizing', count: 3 });
  });

  it('breaks ties by canonical order (deterministic)', () => {
    // all_or_nothing precedes mind_reading in DISTORTION_KEYS.
    expect(thinkingTrapOfWeek([['mind_reading'], ['all_or_nothing']])?.key).toBe('all_or_nothing');
  });
});

describe('isDistortionKey', () => {
  it('validates against the taxonomy', () => {
    expect(isDistortionKey('catastrophizing')).toBe(true);
    expect(isDistortionKey('nope')).toBe(false);
  });
});

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(over: Partial<DiaryDraft> = {}): DiaryDraft {
  return {
    situation: '',
    thoughts: '',
    emotions: [],
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: '',
    mood: null,
    ...over,
  };
}

describe('diary distortions', () => {
  it('round-trips tags and the weekly window feeds the trap', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const now = new Date();
    const old = new Date(now);
    old.setDate(old.getDate() - 30); // outside the 7-day window

    const id = await saveDiaryEntry(db, draft({ distortions: ['catastrophizing'] }), now);
    await saveDiaryEntry(db, draft({ distortions: ['catastrophizing', 'mind_reading'] }), now);
    await saveDiaryEntry(db, draft({ distortions: ['mind_reading'] }), old);

    expect((await getDiaryEntry(db, id))?.distortions).toEqual(['catastrophizing']);

    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const tags = await listDistortionTagsSince(db, weekAgo);
    // The 30-day-old mind_reading entry is excluded from the window.
    expect(thinkingTrapOfWeek(tags)).toEqual({ key: 'catastrophizing', count: 2 });
    sqlite.close();
  });

  it('defaults to no tags when the draft omits them', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const id = await saveDiaryEntry(db, draft({ thoughts: 'x' }));
    expect((await getDiaryEntry(db, id))?.distortions).toEqual([]);
    sqlite.close();
  });
});
