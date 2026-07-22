import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  backfillHealth,
  catchUpHealth,
  CATCHUP_DAYS,
  syncDayHealth,
  syncDayWorkouts,
} from '@/lib/core/db/healthSync';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { getStepsRow, setManualSteps, upsertSteps } from '@/lib/core/db/steps';
import { upsertWeight } from '@/lib/core/db/weight';
import { addTrackerWorkout, addWorkout, deleteWorkout, listWorkoutsForDay } from '@/lib/core/db/workouts';
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
  /// Per-interval energy, same key shape as `stepsByWindow` — lets a test give
  /// each stretch of a day its own burn, which is the only way to observe that
  /// overlapping sessions are priced on their exclusive parts.
  kcalByWindow?: Record<string, number>;
  daySteps?: number | null;
}): HealthService & { stepWindowCalls: string[]; kcalWindowCalls: string[] } {
  const svc = {
    stepWindowCalls: [] as string[],
    kcalWindowCalls: [] as string[],
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
    async activeKcalInWindow(start: Date, end: Date) {
      const key = `${start.toISOString()}|${end.toISOString()}`;
      svc.kcalWindowCalls.push(key);
      if (opts.kcalByWindow) return opts.kcalByWindow[key] ?? 0;
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

  it('keeps subtracting for already-imported rows after session access is lost', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 9000, 'device');
    const stepsByWindow = { [`${at(18)}|${at(19)}`]: 1200 };
    await syncDayWorkouts(db, fakeService({ sessions: [session('w1', 18, 19)], stepsByWindow }), DAY);

    // The user revokes the workout permission but keeps steps: sessions read as
    // null now. The row is still in the log, so its window is still ours to
    // price — the subtraction tracks the DATA, not the last successful fetch.
    const blind = fakeService({ sessions: null, stepsByWindow });
    expect(await syncDayWorkouts(db, blind, DAY)).toBe(1200);
    sqlite.close();
  });
});

describe('overlapping sessions are priced on their exclusive stretch', () => {
  // The watch auto-detects a walk 18:00–19:00 while the user also runs a manual
  // session 18:30–19:30. Energy flows at a steady 5 kcal/min, so the union
  // (18:00–19:30, 90 min) really cost 450 — not 600.
  const kcalByWindow = {
    [`${at(18)}|${at(19)}`]: 300, // session A, all of it exclusive
    [`${at(19)}|${at(19, 30)}`]: 150, // session B, only its tail is exclusive
    [`${at(18, 30)}|${at(19, 30)}`]: 300, // what B's FULL window would have billed
  };
  const overlapping = [
    session('a', 18, 19),
    session('b', 18, 19, 'run', { start: at(18, 30), end: at(19, 30) }),
  ];

  it('the day’s total equals the union, not the sum of both windows', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 9000, 'device');

    await syncDayWorkouts(db, fakeService({ sessions: overlapping, kcalByWindow }), DAY);

    const rows = await listWorkoutsForDay(db, DAY);
    expect(rows).toHaveLength(2);
    const total = rows.reduce((s, r) => s + Number(r.kcal), 0);
    expect(total).toBe(450); // was 600 — the shared half hour billed twice
    // Each row still carries a number that means something on its own.
    expect(rows.find((r) => r.externalId === 'a')?.kcal).toBe(300);
    expect(rows.find((r) => r.externalId === 'b')?.kcal).toBe(150);
    sqlite.close();
  });

  it('a session fully swallowed by an earlier one earns 0, not a second copy', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const nested = [
      session('outer', 18, 20),
      session('inner', 18, 20, 'run', { start: at(18, 30), end: at(19, 30) }),
    ];
    await syncDayWorkouts(
      db,
      fakeService({ sessions: nested, kcalByWindow: { [`${at(18)}|${at(20)}`]: 600 } }),
      DAY,
    );

    const rows = await listWorkoutsForDay(db, DAY);
    expect(rows.find((r) => r.externalId === 'outer')?.kcal).toBe(600);
    expect(rows.find((r) => r.externalId === 'inner')?.kcal).toBe(0);
    sqlite.close();
  });

  it('the ≈MET fallback is apportioned too — half the window, half the estimate', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    // No measured energy anywhere, so both fall through to the MET path.
    await syncDayWorkouts(
      db,
      fakeService({ sessions: overlapping, windowKcal: null }),
      DAY,
    );

    const rows = await listWorkoutsForDay(db, DAY);
    // B overlaps A for 30 of its 60 minutes → it is estimated on 30.
    const a = rows.find((r) => r.externalId === 'a')!;
    const b = rows.find((r) => r.externalId === 'b')!;
    expect(b.kcal).toBe(Math.round(a.kcal / 2));
    expect(a.minutes).toBe(60); // the duration shown is still what was done
    expect(b.minutes).toBe(60);
    sqlite.close();
  });

  it('the split does not drift when the store returns the sessions reversed', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await syncDayWorkouts(
      db,
      fakeService({ sessions: [...overlapping].reverse(), kcalByWindow }),
      DAY,
    );
    const rows = await listWorkoutsForDay(db, DAY);
    expect(rows.find((r) => r.externalId === 'a')?.kcal).toBe(300);
    expect(rows.find((r) => r.externalId === 'b')?.kcal).toBe(150);
    sqlite.close();
  });
});

describe('syncDayHealth', () => {
  it('with extended=false imports nothing — and has nothing to subtract', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const svc = fakeService({ sessions: [session('w1', 18, 19)], daySteps: 6400, windowKcal: 300 });
    const res = await syncDayHealth(db, svc, DAY, false);

    expect(res.steps).toBe(6400);
    // The subtraction runs regardless now, but with no logged workout there is
    // no window to price — same 0 as when it lived inside the extended branch.
    expect(res.workoutSteps).toBe(0);
    expect(await listWorkoutsForDay(db, DAY)).toHaveLength(0); // no extended writes
    sqlite.close();
  });

  it('subtracts a HAND-LOGGED workout’s steps with extended=false — the default', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 10_000, 'device');

    // An hour's walk logged at 19:00 ⇒ the window is 18:00–19:00.
    const loggedAt = new Date(2026, 6, 16, 19, 0);
    await addWorkout(db, 'walk', 60, 80, null, loggedAt);

    const svc = fakeService({
      sessions: null, // no device import at all — this is the default setup
      daySteps: 10_000,
      stepsByWindow: { [`${at(18)}|${at(19)}`]: 6000 },
    });
    const res = await syncDayHealth(db, svc, DAY, false);

    // Those 6000 steps are the walk's own; pricing them as «шаги +N» AND as the
    // workout's burn is the double count this exists to stop.
    expect(res.workoutSteps).toBe(6000);
    sqlite.close();
  });

  it('a zero-duration «по часам» entry has no window, so it subtracts nothing', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertSteps(db, DAY, 10_000, 'device');
    // kcal off a watch face, no minutes given — there is no stretch to attribute.
    await addTrackerWorkout(db, { kcal: 400, minutes: 0 }, new Date(2026, 6, 16, 19, 0));

    const svc = fakeService({ sessions: null, daySteps: 10_000, stepsPerCall: 5000 });
    expect((await syncDayHealth(db, svc, DAY, false)).workoutSteps).toBe(0);
    expect(svc.stepWindowCalls).toHaveLength(0);
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

describe('catchUpHealth (the days the app was never opened)', () => {
  /// A service that serves the same step count for every day asked, and remembers
  /// which days were asked for — the whole point of the catch-up is WHICH days.
  function recordingService(perDay: number | null) {
    const asked: string[] = [];
    const svc: HealthService & { asked: string[] } = {
      asked,
      source: 'device' as const,
      async requestPermissions() {
        return true;
      },
      async stepsForDay(d: Date) {
        asked.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
        return perDay;
      },
      async sleepForDay() {
        return null;
      },
    };
    return svc;
  }

  it('fills the missed days and leaves the ones already recorded alone', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    // The user opened the app 4 days ago and not since.
    await upsertSteps(db, new Date(2026, 6, 12), 7000, 'device');

    const svc = recordingService(5000);
    const filled = await catchUpHealth(db, svc, false, DAY); // DAY = 2026-07-16

    // 15, 14, 13 and 11..2 were missing; the 12th already had a row and is not
    // re-asked. Today (16th) is not the catch-up's job — the screens sync it.
    expect(svc.asked).not.toContain('2026-7-12');
    expect(svc.asked).not.toContain('2026-7-16');
    expect(filled).toBeGreaterThan(0);
    expect(Number((await getStepsRow(db, new Date(2026, 6, 15)))?.steps)).toBe(5000);
    expect(Number((await getStepsRow(db, new Date(2026, 6, 12)))?.steps)).toBe(7000); // untouched
    sqlite.close();
  });

  it('costs nothing but keyed reads for a user who opens the app daily', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    for (let back = 1; back <= CATCHUP_DAYS; back++) {
      await upsertSteps(db, new Date(2026, 6, 16 - back), 6000, 'device');
    }
    const svc = recordingService(5000);
    expect(await catchUpHealth(db, svc, false, DAY)).toBe(0);
    expect(svc.asked).toHaveLength(0); // provider never touched
    sqlite.close();
  });

  it('gives up after a few silent days instead of walking the whole fortnight', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    // Permission revoked / nothing recorded: every day answers null.
    const svc = recordingService(null);
    expect(await catchUpHealth(db, svc, false, DAY)).toBe(0);
    expect(svc.asked).toHaveLength(3); // CATCHUP_MISS_LIMIT, then it stops
    sqlite.close();
  });

  it('never overwrites a hand-entered day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await setManualSteps(db, new Date(2026, 6, 14), 12_345);
    const svc = recordingService(5000);
    await catchUpHealth(db, svc, false, DAY);
    const row = await getStepsRow(db, new Date(2026, 6, 14));
    expect(Number(row?.steps)).toBe(12_345);
    expect(row?.source).toBe('manual');
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
