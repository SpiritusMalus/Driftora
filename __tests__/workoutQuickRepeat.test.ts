import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import {
  addTrackerWorkout,
  addWorkout,
  deriveQuickWorkouts,
  listWorkoutsForDay,
  quickWorkoutKcal,
  quickWorkouts,
  repeatWorkout,
  type QuickWorkout,
} from '@/lib/core/db/workouts';
import { workoutKcal } from '@/lib/core/insights/bodyMetrics';

/** «Повторить» — one-tap re-logging of a workout the user already entered. */

async function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  await applySchema((sql) => sqlite.exec(sql));
  return db;
}

const mk = (
  type: string,
  minutes: number,
  ts: Date,
  extra: Partial<{
    label: string | null;
    sets: number | null;
    speedKmh: number | null;
    intensity: string | null;
    kcal: number;
    source: string;
  }> = {},
) => ({
  type,
  label: null,
  sets: null,
  speedKmh: null,
  intensity: null,
  kcal: 200,
  source: 'manual',
  minutes,
  ts,
  ...extra,
});

// Ходьба 30 мин logged three times, бег 20 мин once (the newest single entry).
const rows = [
  mk('run', 20, new Date(2026, 6, 21, 19, 0)),
  mk('walk', 30, new Date(2026, 6, 21, 8, 0)),
  mk('walk', 30, new Date(2026, 6, 20, 8, 0)),
  mk('walk', 30, new Date(2026, 6, 19, 8, 0)),
  mk('yoga', 40, new Date(2026, 6, 18, 21, 0)),
];

describe('deriveQuickWorkouts', () => {
  it('collapses identical workouts and leads with the repeated ones', () => {
    const quick = deriveQuickWorkouts(rows);
    expect(quick.map((q) => `${q.type}:${q.minutes}`)).toEqual(['walk:30', 'run:20', 'yoga:40']);
    expect(quick[0].count).toBe(3);
    // Singles keep their own order — newest first.
    expect(quick[1].count).toBe(1);
  });

  it('is order-independent (input row order does not change output)', () => {
    const shuffled = [...rows].reverse();
    expect(deriveQuickWorkouts(shuffled).map((q) => `${q.type}:${q.minutes}`)).toEqual([
      'walk:30',
      'run:20',
      'yoga:40',
    ]);
  });

  it('keeps differing durations, paces and effort levels apart', () => {
    const quick = deriveQuickWorkouts([
      mk('walk', 30, new Date(2026, 6, 21, 8, 0)),
      mk('walk', 45, new Date(2026, 6, 20, 8, 0)),
      mk('walk', 30, new Date(2026, 6, 19, 8, 0), { speedKmh: 6 }),
      mk('strength', 36, new Date(2026, 6, 18, 8, 0), { sets: 12, intensity: 'heavy' }),
      mk('strength', 36, new Date(2026, 6, 17, 8, 0), { sets: 12, intensity: 'light' }),
    ]);
    expect(quick).toHaveLength(5);
  });

  it('excludes measured rows — a watch/tracker reading is not a template', () => {
    const quick = deriveQuickWorkouts([
      mk('run', 30, new Date(2026, 6, 21, 8, 0), { source: 'tracker', kcal: 400 }),
      mk('run', 30, new Date(2026, 6, 20, 8, 0), { source: 'device', kcal: 410 }),
      mk('run', 30, new Date(2026, 6, 19, 8, 0), { source: 'ai', label: 'пробежка в парке' }),
    ]);
    expect(quick).toHaveLength(1);
    expect(quick[0].source).toBe('ai');
    expect(quick[0].label).toBe('пробежка в парке');
  });

  it('skips rows with nothing to repeat, and caps the list', () => {
    expect(deriveQuickWorkouts([mk('other', 0, new Date(2026, 6, 21))])).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => mk('walk', 10 + i, new Date(2026, 6, 21, i)));
    expect(deriveQuickWorkouts(many)).toHaveLength(8);
    expect(deriveQuickWorkouts(many, 3)).toHaveLength(3);
  });

  it('takes kcal from the most recent occurrence', () => {
    const quick = deriveQuickWorkouts([
      mk('walk', 30, new Date(2026, 6, 19, 8, 0), { kcal: 100 }),
      mk('walk', 30, new Date(2026, 6, 21, 8, 0), { kcal: 150 }),
    ]);
    expect(quick[0].kcal).toBe(150);
  });
});

describe('quickWorkoutKcal', () => {
  const walk: QuickWorkout = {
    type: 'walk',
    label: null,
    minutes: 30,
    sets: null,
    speedKmh: null,
    intensity: null,
    kcal: 111,
    source: 'manual',
    count: 2,
  };

  it('recomputes a known type from the CURRENT weight, ignoring the stored kcal', () => {
    expect(quickWorkoutKcal(walk, 80)).toBe(workoutKcal('walk', 30, 80));
    expect(quickWorkoutKcal(walk, 100)).toBeGreaterThan(quickWorkoutKcal(walk, 80));
  });

  it('reuses the stored number for an unknown activity — its MET was never stored', () => {
    const other: QuickWorkout = { ...walk, type: 'other', kcal: 240 };
    expect(quickWorkoutKcal(other, 80)).toBe(240);
    expect(quickWorkoutKcal(other, 100)).toBe(240);
  });
});

describe('repeatWorkout (db round-trip)', () => {
  it('re-logs a past entry for today with its pace, sets and effort intact', async () => {
    const db = await makeDb();
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    await addWorkout(db, 'strength', 36, 80, null, yesterday, 12, 'heavy');
    await addWorkout(db, 'walk', 30, 80, 6, yesterday);

    const quick = await quickWorkouts(db);
    expect(quick).toHaveLength(2);

    const strength = quick.find((q) => q.type === 'strength')!;
    const kcal = await repeatWorkout(db, strength, 80);
    expect(kcal).toBe(workoutKcal('strength', 36, 80, null, 'heavy'));

    const today = await listWorkoutsForDay(db);
    expect(today).toHaveLength(1); // yesterday's rows are not in today's list
    expect(today[0]).toMatchObject({
      type: 'strength',
      minutes: 36,
      sets: 12,
      intensity: 'heavy',
      source: 'manual',
      kcal,
    });

    const walk = quick.find((q) => q.type === 'walk')!;
    expect(walk.speedKmh).toBe(6);
    await repeatWorkout(db, walk, 80);
    // Both repeats share the same second, so pick by type rather than position.
    const walkRow = (await listWorkoutsForDay(db)).find((r) => r.type === 'walk')!;
    expect(walkRow.speedKmh).toBe(6);
    expect(walkRow.kcal).toBe(workoutKcal('walk', 30, 80, 6));
  });

  it('a repeat then counts as a repeat itself (one chip, count grows)', async () => {
    const db = await makeDb();
    await addWorkout(db, 'walk', 30, 80, null, new Date(Date.now() - 24 * 3600_000));
    const [walk] = await quickWorkouts(db);
    expect(walk.count).toBe(1);
    await repeatWorkout(db, walk, 80);
    const after = await quickWorkouts(db);
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(2);
  });

  it('a tracker entry never becomes a repeat chip', async () => {
    const db = await makeDb();
    await addTrackerWorkout(db, { kcal: 300, minutes: 45, type: 'other', label: 'по трекеру' });
    expect(await quickWorkouts(db)).toEqual([]);
  });
});
