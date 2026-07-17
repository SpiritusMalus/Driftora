import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { backfillHealth, syncDayHealth, syncDayWorkouts } from '@/lib/core/db/healthSync';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { getStepsRow, setManualSteps, upsertSteps } from '@/lib/core/db/steps';
import { upsertWeight } from '@/lib/core/db/weight';
import { addWorkout, deleteWorkout, listWorkoutsForDay } from '@/lib/core/db/workouts';
import { workoutKcal } from '@/lib/core/insights/bodyMetrics';
import type { DeviceWorkoutSession, HealthService } from '@/lib/core/services/health';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/// The test day, away from midnight edge cases unless a test wants them.
const DAY = new Date(2026, 6, 16, 12, 0); // local 2026-07-16
const at = (h: number, m = 0, day = 16) => new Date(2026, 6, day, h, m).toISOString();

/// A configurable fake device. `stepsByWindow` maps `${startISO}|${endISO}` →
/// count; unmatched windows return `stepsPerCall` (default 0).
function fakeService(opts: {
  sessions?: DeviceWorkoutSession[] | null;
  stepsByWindow?: Record<string, number>;
  stepsPerCall?: number;
  windowKcal?: number | null;
  daySteps?: number | null;
}): HealthService & { stepWindowCalls: string[] } {
  const svc = {
    stepWindowCalls: [] as string[],
    source: 'device' as const,
    async requestPermissions() {
      return true;
    },
    async stepsForDay() {
      return opts.daySteps ?? null;
    },
    async sleepForDay() {
      return null;
    },
    async workoutSessionsForDay() {
      return opts.sessions ?? null;
    },
    async stepsInWindow(start: Date, end: Date) {
      const key = `${start.toISOString()}|${end.toISOString()}`;
      svc.stepWindowCalls.push(key);
      return opts.stepsByWindow?.[key] ?? opts.stepsPerCall ?? 0;
    },
    async activeKcalInWindow() {
      return opts.windowKcal ?? null;
    },
  };
  return svc;
}

const session = (
  id: string,
  startH: number,
  endH: number,
  type = 'run',
  extra: Partial<DeviceWorkoutSession> = {},
): DeviceWorkoutSession => ({
  externalId: id,
  start: at(startH),
  end: at(endH),
  type,
  title: null,
  deviceKcal: null,
  origin: 'test',
  ...extra,
});

describe('syncDayWorkouts', () => {
  it('imports a session with measured window kcal and per-row window steps', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 9000, 'device');

    const svc = fakeService({
      sessions: [session('w1', 18, 19)],
      stepsPerCall: 1200,
      windowKcal: 380,
    });
    const union = await syncDayWorkouts(db, svc, DAY);

    expect(union).toBe(1200);
    expect((await getStepsRow(db, DAY))?.workoutSteps).toBe(1200);
    const rows = await listWorkoutsForDay(db, DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'device',
      externalId: 'w1',
      type: 'run',
      minutes: 60,
      kcal: 380,
      kcalFrom: 'device',
      stepsInWindow: 1200,
      date: '2026-07-16',
    });
    sqlite.close();
  });

  it('falls back to the app ≈MET when the store has no energy (marked met)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertWeight(db, '2026-07-15', 80);

    const svc = fakeService({ sessions: [session('w1', 18, 19, 'run')], windowKcal: null });
    await syncDayWorkouts(db, svc, DAY);

    const [row] = await listWorkoutsForDay(db, DAY);
    expect(row.kcalFrom).toBe('met');
    expect(row.kcal).toBe(workoutKcal('run', 60, 80)); // same math as a manual log
    sqlite.close();
  });

  it('subtracts the MERGED union for overlapping sessions, not the per-row sum', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 9000, 'device');

    // Auto-detect 18:00–18:40 + manual 18:20–19:00 → union 18:00–19:00. The
    // union query (one merged window) returns 1500; per-session windows return
    // 1000 each — a naive sum would subtract 2000.
    const svc = fakeService({
      sessions: [session('a', 18, 18.6667), session('b', 18.3333, 19)],
      stepsByWindow: {
        [`${at(18)}|${at(19)}`]: 1500,
      },
      stepsPerCall: 1000,
    });
    // Windows with fractional hours: build explicitly.
    svc.workoutSessionsForDay = async () => [
      { ...session('a', 18, 19), start: at(18, 0), end: at(18, 40) },
      { ...session('b', 18, 19), start: at(18, 20), end: at(19, 0) },
    ];

    const union = await syncDayWorkouts(db, svc, DAY);
    expect(union).toBe(1500); // merged union, queried once
    expect((await getStepsRow(db, DAY))?.workoutSteps).toBe(1500);
    expect(await listWorkoutsForDay(db, DAY)).toHaveLength(2);
    sqlite.close();
  });

  it('is idempotent by externalId — a re-sync updates, never duplicates', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const svc1 = fakeService({ sessions: [session('w1', 18, 19)], windowKcal: 300 });
    await syncDayWorkouts(db, svc1, DAY);
    // Watch data firmed up: longer session, more kcal.
    const svc2 = fakeService({
      sessions: [{ ...session('w1', 18, 19), end: at(19, 10) }],
      windowKcal: 340,
    });
    await syncDayWorkouts(db, svc2, DAY);

    const rows = await listWorkoutsForDay(db, DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0].minutes).toBe(70);
    expect(rows[0].kcal).toBe(340);
    sqlite.close();
  });

  it('never resurrects a deleted import (tombstone) and clears its subtraction', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 9000, 'device');

    const svc = fakeService({ sessions: [session('w1', 18, 19)], stepsPerCall: 1200, windowKcal: 300 });
    await syncDayWorkouts(db, svc, DAY);
    const [row] = await listWorkoutsForDay(db, DAY);
    await deleteWorkout(db, row.id);

    await syncDayWorkouts(db, svc, DAY); // passive re-sync
    expect(await listWorkoutsForDay(db, DAY)).toHaveLength(0);
    // The deleted session no longer subtracts steps either.
    expect((await getStepsRow(db, DAY))?.workoutSteps).toBe(0);
    sqlite.close();
  });

  it('leaves manual workout rows completely untouched', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await addWorkout(db, 'strength', 45, 80, null, DAY);

    const svc = fakeService({ sessions: [session('w1', 18, 19)], windowKcal: 300 });
    await syncDayWorkouts(db, svc, DAY);

    const rows = await listWorkoutsForDay(db, DAY);
    expect(rows).toHaveLength(2);
    const manual = rows.find((r) => r.source === 'manual');
    expect(manual).toBeDefined();
    expect(manual?.type).toBe('strength');
    sqlite.close();
  });

  it('keeps a manual steps day sticky but still writes its subtraction', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await setManualSteps(db, DAY, 10000);

    const svc = fakeService({ sessions: [session('w1', 18, 19)], stepsPerCall: 900, windowKcal: 300 });
    await syncDayWorkouts(db, svc, DAY);

    const row = await getStepsRow(db, DAY);
    expect(row?.steps).toBe(10000); // typed value untouched
    expect(row?.source).toBe('manual'); // stickiness untouched
    expect(row?.workoutSteps).toBe(900); // honest subtraction still lands
    sqlite.close();
  });

  it('splits a midnight session: kcal on the start day, steps clipped per day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, new Date(2026, 6, 16), 8000, 'device');
    await upsertSteps(db, new Date(2026, 6, 17), 7000, 'device');

    // 23:30 (16th) → 00:30 (17th).
    const crosser: DeviceWorkoutSession = {
      externalId: 'night',
      start: at(23, 30, 16),
      end: at(0, 30, 17),
      type: 'run',
      title: null,
      deviceKcal: null,
      origin: 'test',
    };
    const mkSvc = () =>
      fakeService({
        sessions: [crosser],
        stepsByWindow: {
          // Full window (per-row display) and each day's clipped stretch.
          [`${at(23, 30, 16)}|${at(0, 30, 17)}`]: 1000,
          [`${at(23, 30, 16)}|${at(0, 0, 17)}`]: 500,
          [`${at(0, 0, 17)}|${at(0, 30, 17)}`]: 500,
        },
        windowKcal: 200,
      });

    const union16 = await syncDayWorkouts(db, mkSvc(), new Date(2026, 6, 16, 12));
    const union17 = await syncDayWorkouts(db, mkSvc(), new Date(2026, 6, 17, 12));

    expect(union16).toBe(500); // only the pre-midnight stretch
    expect(union17).toBe(500); // only the post-midnight stretch
    // ONE row, dated by the session's start day — same semantics as manual ts.
    expect(await listWorkoutsForDay(db, '2026-07-16')).toHaveLength(1);
    expect(await listWorkoutsForDay(db, '2026-07-17')).toHaveLength(0);
    sqlite.close();
  });

  it('returns the stored value when the service cannot read sessions', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const svc: HealthService = {
      async requestPermissions() {
        return false;
      },
      async stepsForDay() {
        return null;
      },
      async sleepForDay() {
        return null;
      },
    };
    expect(await syncDayWorkouts(db, svc, DAY)).toBe(0);
    expect(await listWorkoutsForDay(db, DAY)).toHaveLength(0);
    sqlite.close();
  });
});

describe('syncDayHealth', () => {
  it('with extended=false performs ONLY the legacy steps+sleep sync', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const svc = fakeService({ sessions: [session('w1', 18, 19)], daySteps: 6400, windowKcal: 300 });
    const res = await syncDayHealth(db, svc, DAY, false);

    expect(res.steps).toBe(6400);
    expect(res.workoutSteps).toBe(0);
    expect(await listWorkoutsForDay(db, DAY)).toHaveLength(0); // no extended writes
    sqlite.close();
  });

  it('with extended=true imports workouts and returns the day subtraction', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const svc = fakeService({
      sessions: [session('w1', 18, 19)],
      daySteps: 6400,
      stepsPerCall: 1100,
      windowKcal: 300,
    });
    const res = await syncDayHealth(db, svc, DAY, true);

    expect(res.steps).toBe(6400);
    expect(res.workoutSteps).toBe(1100);
    expect(await listWorkoutsForDay(db, DAY)).toHaveLength(1);
    sqlite.close();
  });
});

describe('backfillHealth', () => {
  it('imports sessions across the workout window without duplicating on re-run', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    // Sessions live on the 15th and 16th; backfill runs "now" = the 16th.
    const s15: DeviceWorkoutSession = {
      externalId: 'd15',
      start: at(18, 0, 15),
      end: at(19, 0, 15),
      type: 'walk',
      title: null,
      deviceKcal: null,
      origin: 'test',
    };
    const s16 = session('d16', 18, 19, 'run');
    const svc: HealthService = {
      ...fakeService({ windowKcal: 250 }),
      async workoutSessionsForDay(day: Date) {
        if (day.getDate() === 15) return [s15];
        if (day.getDate() === 16) return [s16];
        return [];
      },
    };

    await backfillHealth(db, svc, { weightDays: 1, workoutDays: 3 }, DAY);
    await backfillHealth(db, svc, { weightDays: 1, workoutDays: 3 }, DAY); // idempotent

    expect(await listWorkoutsForDay(db, '2026-07-15')).toHaveLength(1);
    expect(await listWorkoutsForDay(db, '2026-07-16')).toHaveLength(1);
    sqlite.close();
  });
});
