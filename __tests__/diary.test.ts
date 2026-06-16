import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  countDiaryEntries,
  getDiaryEntry,
  listDiaryEntries,
  saveDiaryEntry,
  type DiaryDraft,
} from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(partial: Partial<DiaryDraft> = {}): DiaryDraft {
  return {
    situation: 'получил критику на встрече',
    thoughts: 'я всё провалил',
    emotions: [{ name: 'тревога', intensity: 70 }],
    reactionBody: 'напряжение в груди',
    reactionBehavior: 'замолчал',
    evidenceFor: 'одна ошибка была',
    evidenceAgainst: 'остальное сделал хорошо',
    reframe: 'одна неудача не отменяет мою работу',
    mood: 6,
    ...partial,
  };
}

describe('diary (СМЭР thought records)', () => {
  it('round-trips all fields, including emotions and mood', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const id = await saveDiaryEntry(db, draft());
    const e = await getDiaryEntry(db, id);

    expect(e).not.toBeNull();
    expect(e!.situation).toBe('получил критику на встрече');
    expect(e!.emotions).toEqual([{ name: 'тревога', intensity: 70 }]);
    expect(e!.reactionBody).toBe('напряжение в груди');
    expect(e!.evidenceAgainst).toBe('остальное сделал хорошо');
    expect(e!.reframe).toBe('одна неудача не отменяет мою работу');
    expect(e!.mood).toBe(6);

    sqlite.close();
  });

  it('lists entries newest-first and honors a limit', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await saveDiaryEntry(db, draft({ situation: 'older' }), new Date(2026, 0, 1));
    await saveDiaryEntry(db, draft({ situation: 'newer' }), new Date(2026, 1, 1));

    const all = await listDiaryEntries(db);
    expect(all.map((e) => e.situation)).toEqual(['newer', 'older']);

    const one = await listDiaryEntries(db, 1);
    expect(one).toHaveLength(1);
    expect(one[0].situation).toBe('newer');

    sqlite.close();
  });

  it('counts entries', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    expect(await countDiaryEntries(db)).toBe(0);
    await saveDiaryEntry(db, draft());
    await saveDiaryEntry(db, draft());
    expect(await countDiaryEntries(db)).toBe(2);

    sqlite.close();
  });

  it('allows a null mood and empty emotions', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const id = await saveDiaryEntry(db, draft({ mood: null, emotions: [] }));
    const e = await getDiaryEntry(db, id);
    expect(e!.mood).toBeNull();
    expect(e!.emotions).toEqual([]);

    sqlite.close();
  });

  it('tolerates malformed emotions JSON on read', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await db
      .insert(schema.diaryEntries)
      .values({ ts: new Date(2026, 0, 1), situation: 'x', emotions: 'not-json' });

    const list = await listDiaryEntries(db);
    expect(list[0].emotions).toEqual([]);

    sqlite.close();
  });

  it('returns null for a missing id', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    expect(await getDiaryEntry(db, 999)).toBeNull();
    sqlite.close();
  });
});
