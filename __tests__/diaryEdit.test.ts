import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import {
  deleteDiaryEntry,
  getDiaryEntry,
  listDiaryEntries,
  saveDiaryEntry,
  updateDiaryEntry,
  type DiaryDraft,
} from '@/lib/core/db/diary';
import * as schema from '@/lib/core/db/schema';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

const original: DiaryDraft = {
  situation: 'дедлайн',
  thoughts: 'я не успею',
  emotions: [{ name: 'тревога', intensity: 80 }],
  reactionBody: 'сжатие в груди',
  reactionBehavior: 'откладывал',
  evidenceFor: 'осталось мало времени',
  evidenceAgainst: 'раньше успевал',
  reframe: 'сделаю по частям',
  moodBefore: 3,
  mood: 6,
  distortions: ['catastrophizing'],
};

const edited: DiaryDraft = {
  situation: 'дедлайн (правка)',
  thoughts: 'успею, если начну',
  emotions: [
    { name: 'тревога', intensity: 40 },
    { name: 'решимость', intensity: 70 },
  ],
  reactionBody: 'спокойнее',
  reactionBehavior: 'начал',
  evidenceFor: '',
  evidenceAgainst: 'план готов',
  reframe: 'шаг за шагом',
  moodBefore: 3,
  mood: 8,
  distortions: ['mind_reading', 'all_or_nothing'],
};

describe('diary entry edit/delete', () => {
  it('updateDiaryEntry round-trips every field incl. emotions/distortions JSON', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await saveDiaryEntry(db, original);

    await updateDiaryEntry(db, id, edited);

    const after = await getDiaryEntry(db, id);
    expect(after).not.toBeNull();
    expect(after!.situation).toBe('дедлайн (правка)');
    expect(after!.thoughts).toBe('успею, если начну');
    expect(after!.reactionBody).toBe('спокойнее');
    expect(after!.evidenceFor).toBe('');
    expect(after!.evidenceAgainst).toBe('план готов');
    expect(after!.reframe).toBe('шаг за шагом');
    expect(after!.moodBefore).toBe(3);
    expect(after!.mood).toBe(8);
    expect(after!.emotions).toEqual(edited.emotions);
    expect(after!.distortions).toEqual(['mind_reading', 'all_or_nothing']);
    sqlite.close();
  });

  it('updateDiaryEntry preserves the original ts when none is given', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const ts = new Date('2026-06-20T08:30:00Z');
    const id = await saveDiaryEntry(db, original, ts);

    await updateDiaryEntry(db, id, edited);

    const after = await getDiaryEntry(db, id);
    expect(after!.ts.getTime()).toBe(ts.getTime());
    sqlite.close();
  });

  it('updateDiaryEntry can change ts when one is passed', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await saveDiaryEntry(db, original, new Date('2026-06-20T08:30:00Z'));
    const newTs = new Date('2026-06-21T09:00:00Z');

    await updateDiaryEntry(db, id, edited, newTs);

    const after = await getDiaryEntry(db, id);
    expect(after!.ts.getTime()).toBe(newTs.getTime());
    sqlite.close();
  });

  it('deleteDiaryEntry removes the row; list/get reflect it', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    const id = await saveDiaryEntry(db, original);
    expect(await listDiaryEntries(db)).toHaveLength(1);

    await deleteDiaryEntry(db, id);

    expect(await getDiaryEntry(db, id)).toBeNull();
    expect(await listDiaryEntries(db)).toHaveLength(0);
    sqlite.close();
  });
});
