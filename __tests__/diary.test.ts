import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    expect(e!.thoughtBelief).toBeNull();
    expect(e!.meanings).toEqual([]);
    expect(e!.coreBelief).toBe('');

    sqlite.close();
  });

  it('keeps a positive thought, exact emotion rating and every meaning after reopening the database', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'driftora-diary-'));
    const filename = join(folder, 'diary.sqlite');
    let sqlite = new BetterSqlite3(filename);
    try {
      await applySchema((s) => sqlite.exec(s));
      const meanings = ['Всё будет в снегу, и я буду любоваться', 'Радость и возвращение в детство', 'Безмятежность и отсутствие тревоги'];
      const id = await saveDiaryEntry(drizzle(sqlite, { schema }), draft({
        thoughts: 'Я получу удовольствие от снега',
        thoughtBelief: 100,
        meanings,
        coreBelief: 'Я умею радоваться',
        emotions: [{ name: 'радость', intensity: 37 }],
      }));
      sqlite.close();
      sqlite = new BetterSqlite3(filename);
      await applySchema((s) => sqlite.exec(s));
      const saved = await getDiaryEntry(drizzle(sqlite, { schema }), id);
      expect(saved).toMatchObject({
        thoughts: 'Я получу удовольствие от снега',
        thoughtBelief: 100,
        meanings,
        coreBelief: 'Я умею радоваться',
        emotions: [{ name: 'радость', intensity: 37 }],
      });
    } finally {
      if (sqlite.open) sqlite.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('stores zero confidence as a rating, distinct from an unanswered question', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const id = await saveDiaryEntry(db, draft({ thoughtBelief: 0 }));
    expect((await getDiaryEntry(db, id))!.thoughtBelief).toBe(0);
    sqlite.close();
  });

  it.each([-1, 101, 3.5, NaN, Infinity])('rejects invalid confidence %s without saving a record', async (thoughtBelief) => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await expect(saveDiaryEntry(db, draft({ thoughtBelief }))).rejects.toThrow(RangeError);
    expect(await countDiaryEntries(db)).toBe(0);
    sqlite.close();
  });

  it.each(['not-json', '{}', 'null'])('tolerates malformed meaning data %s on read', async (meanings) => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await db.insert(schema.diaryEntries).values({ ts: new Date(), meanings });
    expect((await listDiaryEntries(db))[0].meanings).toEqual([]);
    sqlite.close();
  });

  it('ignores non-text meaning elements without changing the text or its order', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await db.insert(schema.diaryEntries).values({
      ts: new Date(),
      meanings: JSON.stringify(['  first\nanswer ', 42, null, 'second answer']),
      thoughtBelief: 150,
    });
    const saved = (await listDiaryEntries(db))[0];
    expect(saved.meanings).toEqual(['  first\nanswer ', 'second answer']);
    expect(saved.thoughtBelief).toBeNull();
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
