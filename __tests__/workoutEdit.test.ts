import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import {
  addParsedWorkout,
  addTrackerWorkout,
  addWorkout,
  editedWorkoutKcal,
  getWorkout,
  importDeviceWorkout,
  updateWorkout,
} from '@/lib/core/db/workouts';
import { workoutKcal } from '@/lib/core/insights/bodyMetrics';
import { daysAgo, shiftDayKey, tsOnDay } from '@/lib/i18n/formatDay';

/** Editing a logged workout — the delete-only log grew a correction path. */

async function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  await applySchema((sql) => sqlite.exec(sql));
  return db;
}

async function onlyRow(db: Awaited<ReturnType<typeof makeDb>>) {
  const rows = (await db.select().from(schema.workouts)) as schema.WorkoutRow[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

const AT = new Date(2026, 7, 20, 18, 30); // 2026-08-20, mid-day — never Date.now()

describe('updateWorkout', () => {
  it('recomputes a known type from the new inputs and current weight', async () => {
    const db = await makeDb();
    await addWorkout(db, 'walk', 30, 70, null, AT);
    const row = await onlyRow(db);
    const stored = await updateWorkout(
      db,
      row.id,
      { type: 'run', label: null, minutes: 45, sets: null, speedKmh: 10, intensity: null },
      80,
    );
    const after = await onlyRow(db);
    expect(stored).toBe(workoutKcal('run', 45, 80, 10, null));
    expect(after.kcal).toBe(stored);
    expect(after.type).toBe('run');
    expect(after.minutes).toBe(45);
    expect(after.speedKmh).toBe(10);
  });

  it('rebuilds the steps window from the new duration for user-logged rows', async () => {
    const db = await makeDb();
    await addWorkout(db, 'walk', 60, 70, null, AT);
    const row = await onlyRow(db);
    await updateWorkout(db, row.id, { type: 'walk', label: null, minutes: 20, sets: null, speedKmh: null, intensity: null }, 70);
    const after = await onlyRow(db);
    expect(after.endTs!.getTime()).toBe(AT.getTime());
    expect(after.startTs!.getTime()).toBe(AT.getTime() - 20 * 60_000);
  });

  it('moves the row to another day keeping the clock time', async () => {
    const db = await makeDb();
    await addWorkout(db, 'walk', 30, 70, null, AT);
    const row = await onlyRow(db);
    await updateWorkout(
      db,
      row.id,
      { type: 'walk', label: null, minutes: 30, sets: null, speedKmh: null, intensity: null, date: '2026-08-18' },
      70,
    );
    const after = await onlyRow(db);
    expect(after.date).toBe('2026-08-18');
    expect(after.ts.getHours()).toBe(18);
    expect(after.ts.getMinutes()).toBe(30);
    expect(after.ts.getDate()).toBe(18);
    // The window moved with the timestamp.
    expect(after.endTs!.getTime()).toBe(after.ts.getTime());
  });

  it('keeps a tracker number verbatim and honours an explicit kcal edit, clamped', async () => {
    const db = await makeDb();
    await addTrackerWorkout(db, { kcal: 300, minutes: 0 }, AT);
    const row = await onlyRow(db);
    const edit = { type: row.type, label: row.label, minutes: 0, sets: null, speedKmh: null, intensity: null };
    // No kcal in the edit → the stored reading survives an unrelated change.
    await updateWorkout(db, row.id, { ...edit, label: 'утренняя' }, 90);
    expect((await onlyRow(db)).kcal).toBe(300);
    // An explicit kcal is the user correcting their own reading.
    await updateWorkout(db, row.id, { ...edit, kcal: 450 }, 90);
    expect((await onlyRow(db)).kcal).toBe(450);
    await updateWorkout(db, row.id, { ...edit, kcal: 99_999 }, 90);
    expect((await onlyRow(db)).kcal).toBe(5000);
  });

  it("scales an unknown activity's kcal with its duration (no MET to recompute)", async () => {
    const db = await makeDb();
    await addParsedWorkout(db, { type: 'games', name_ru: 'бадминтон', minutes: 20, met: 5 }, 70, AT);
    const row = await onlyRow(db);
    const before = Number(row.kcal);
    const stored = await updateWorkout(
      db,
      row.id,
      { type: 'games', label: 'бадминтон', minutes: 40, sets: null, speedKmh: null, intensity: null },
      70,
    );
    expect(stored).toBe(before * 2);
  });

  it('leaves a device row’s measured kcal and real window untouched', async () => {
    const db = await makeDb();
    const start = new Date(2026, 7, 20, 7, 0);
    const end = new Date(2026, 7, 20, 8, 0);
    await importDeviceWorkout(db, {
      externalId: 'hk-1',
      start,
      end,
      type: 'run',
      title: 'Утренняя пробежка',
      minutes: 60,
      kcal: 512,
      kcalFrom: 'device',
      stepsInWindow: 7000,
    });
    const row = await onlyRow(db);
    await updateWorkout(db, row.id, { type: 'run', label: row.label, minutes: 30, sets: null, speedKmh: null, intensity: null }, 70);
    const after = await onlyRow(db);
    expect(after.kcal).toBe(512);
    expect(after.startTs!.getTime()).toBe(start.getTime());
    expect(after.endTs!.getTime()).toBe(end.getTime());
  });

  it('returns 0 for a row that is already gone', async () => {
    const db = await makeDb();
    expect(
      await updateWorkout(db, 12345, { type: 'walk', label: null, minutes: 30, sets: null, speedKmh: null, intensity: null }, 70),
    ).toBe(0);
  });
});

describe('editedWorkoutKcal (the preview = the save)', () => {
  it('matches updateWorkout for a strength edit by sets and effort', async () => {
    const db = await makeDb();
    await addWorkout(db, 'strength', 36, 70, null, AT, 12, 'moderate');
    const row = await onlyRow(db);
    const edit = { type: 'strength', label: null, minutes: 24, sets: 8, speedKmh: null, intensity: 'heavy' as const };
    const preview = editedWorkoutKcal(row, edit, 75);
    const stored = await updateWorkout(db, row.id, edit, 75);
    expect(preview).toBe(stored);
    expect(stored).toBe(workoutKcal('strength', 24, 75, null, 'heavy'));
  });

  it('drops an effort level for non-strength types (same rule as logging)', async () => {
    const db = await makeDb();
    await addWorkout(db, 'strength', 36, 70, null, AT, 12, 'moderate');
    const row = await onlyRow(db);
    await updateWorkout(db, row.id, { type: 'walk', label: null, minutes: 30, sets: null, speedKmh: null, intensity: 'heavy' }, 70);
    const after = await onlyRow(db);
    expect(after.intensity).toBeNull();
    expect(after.kcal).toBe(workoutKcal('walk', 30, 70, null, null));
  });
});

describe('getWorkout / shiftDayKey', () => {
  it('getWorkout returns the row and null after it is gone', async () => {
    const db = await makeDb();
    await addWorkout(db, 'walk', 30, 70, null, AT);
    const row = await onlyRow(db);
    expect((await getWorkout(db, row.id))?.id).toBe(row.id);
    expect(await getWorkout(db, row.id + 1)).toBeNull();
  });

  it('shiftDayKey walks month boundaries', () => {
    expect(shiftDayKey('2026-08-23', -1)).toBe('2026-08-22');
    expect(shiftDayKey('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('garbage', -1)).toBe('garbage');
  });

  it('daysAgo counts back to today and floors at 0', () => {
    const now = new Date(2026, 7, 24, 15, 30); // 2026-08-24
    expect(daysAgo('2026-08-24', now)).toBe(0);
    expect(daysAgo('2026-08-23', now)).toBe(1);
    expect(daysAgo('2026-07-10', now)).toBe(45);
    expect(daysAgo('2026-08-25', now)).toBe(0); // future never widens a floor
    expect(daysAgo('garbage', now)).toBe(0);
  });

  it('tsOnDay keeps the clock time and only moves the day', () => {
    const original = new Date(2026, 7, 24, 19, 45, 12);
    const moved = tsOnDay(original, '2026-08-23');
    expect(moved.getFullYear()).toBe(2026);
    expect(moved.getMonth()).toBe(7);
    expect(moved.getDate()).toBe(23);
    expect(moved.getHours()).toBe(19);
    expect(moved.getMinutes()).toBe(45);
    expect(tsOnDay(original, 'garbage')).toBe(original);
  });
});
