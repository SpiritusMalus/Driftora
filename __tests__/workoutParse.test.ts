import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { addParsedWorkout, addTrackerWorkout, listWorkoutsForDay } from '@/lib/core/db/workouts';
import { kcalFromMet, workoutKcal } from '@/lib/core/insights/bodyMetrics';

async function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  await applySchema((sql) => sqlite.exec(sql));
  return db;
}

describe('kcalFromMet', () => {
  it('MET × kg × hours, whole kcal', () => {
    expect(kcalFromMet(8, 30, 80)).toBe(320); // 8 × 80 × 0.5
  });

  it('clamps garbage — non-positive MET, weight band, minutes ceiling, never NaN', () => {
    expect(kcalFromMet(0, 30, 80)).toBe(0);
    expect(kcalFromMet(-4, 30, 80)).toBe(0);
    expect(Number.isFinite(kcalFromMet(8, 30, 0))).toBe(true); // weight clamps up to 20
    expect(kcalFromMet(8, 99999, 80)).toBe(kcalFromMet(8, 600, 80)); // minutes capped at 10 h
  });
});

describe('addParsedWorkout (LLM parse path → on-device kcal)', () => {
  it('a known type uses the app MET and keeps the free-text label', async () => {
    const db = await makeDb();
    const kcal = await addParsedWorkout(db, { type: 'run', name_ru: 'бег', minutes: 30 }, 130);
    expect(kcal).toBe(workoutKcal('run', 30, 130)); // app owns MET for known types
    const [row] = await listWorkoutsForDay(db);
    expect(row.type).toBe('run');
    expect(row.label).toBe('бег');
    expect(row.speedKmh).toBeNull();
  });

  it('a known type refines kcal by pace when given', async () => {
    const db = await makeDb();
    const fast = await addParsedWorkout(db, { type: 'run', name_ru: 'бег', minutes: 30, speedKmh: 12 }, 130);
    expect(fast).toBe(workoutKcal('run', 30, 130, 12));
    expect(fast).toBeGreaterThan(workoutKcal('run', 30, 130)); // 12 km/h beats the moderate default
  });

  it('an "other" activity uses the model MET (ignored for known types)', async () => {
    const db = await makeDb();
    const kcal = await addParsedWorkout(db, { type: 'other', name_ru: 'отжимания', minutes: 8, met: 8 }, 80);
    expect(kcal).toBe(kcalFromMet(8, 8, 80));
    const [row] = await listWorkoutsForDay(db);
    expect(row.type).toBe('other');
    expect(row.label).toBe('отжимания');
  });

  it('an "other" activity with no MET stores a zero burn, not NaN', async () => {
    const db = await makeDb();
    const kcal = await addParsedWorkout(db, { type: 'other', name_ru: 'нечто', minutes: 10 }, 80);
    expect(kcal).toBe(0);
  });

  it('a strength entry keeps the set count (shown in подходы); kcal carries the afterburn', async () => {
    const db = await makeDb();
    const kcal = await addParsedWorkout(
      db,
      { type: 'strength', name_ru: 'жим лёжа', minutes: 12, sets: 4 },
      80,
    );
    // The model's minutes stay the duration basis; +10% EPOC rides on top.
    expect(kcal).toBe(workoutKcal('strength', 12, 80));
    const [row] = await listWorkoutsForDay(db);
    expect(row.sets).toBe(4);
    expect(row.minutes).toBe(12);
    expect(row.label).toBe('жим лёжа');
  });
});

describe('addTrackerWorkout (a screenshot’s printed burn is logged verbatim)', () => {
  it('stores the device kcal as-is — no MET math, no EPOC bonus', async () => {
    const db = await makeDb();
    const kcal = await addTrackerWorkout(db, {
      kcal: 412,
      minutes: 31,
      type: 'run',
      label: 'бег 5 км · по трекеру',
    });
    expect(kcal).toBe(412);
    const [row] = await listWorkoutsForDay(db);
    expect(row.kcal).toBe(412);
    expect(row.minutes).toBe(31);
    expect(row.type).toBe('run');
    expect(row.label).toBe('бег 5 км · по трекеру');
    expect(row.sets).toBeNull();
  });

  it('clamps an absurd device number instead of blowing up the day', async () => {
    const db = await makeDb();
    const kcal = await addTrackerWorkout(db, { kcal: 99_999, minutes: 20 });
    expect(kcal).toBe(5000);
    expect((await addTrackerWorkout(db, { kcal: -50, minutes: 20 }))).toBe(0);
  });
});
