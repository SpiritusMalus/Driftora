import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import {
  dayKey,
  getStepsForDay,
  getStepsRow,
  listStepsDays,
  setManualSteps,
  syncDaySteps,
  upsertSteps,
} from '@/lib/core/db/steps';
import type { HealthService } from '@/lib/core/services/health';
import { NullHealthService } from '@/lib/core/services/healthProvider';
import { StubHealthService } from '@/lib/core/services/stubHealthService';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('dayKey', () => {
  it('formats a local calendar day as YYYY-MM-DD', () => {
    expect(dayKey(new Date(2026, 5, 16))).toBe('2026-06-16');
    expect(dayKey(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('steps storage (steps_days)', () => {
  it('returns 0 before anything is synced', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    expect(await getStepsForDay(db, new Date(2026, 5, 16))).toBe(0);

    sqlite.close();
  });

  it('upsert stores then overwrites the same day (one row per date)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    await upsertSteps(db, day, 4000);
    expect(await getStepsForDay(db, day)).toBe(4000);

    await upsertSteps(db, day, 6800); // same day → replace, not duplicate
    expect(await getStepsForDay(db, day)).toBe(6800);

    const rows = await db.select().from(schema.stepsDays);
    expect(rows).toHaveLength(1);

    sqlite.close();
  });

  it('syncDaySteps writes the service count and returns it', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    const stored = await syncDaySteps(db, new StubHealthService(), day);
    expect(stored).toBe(await new StubHealthService().stepsForDay(day));
    expect(await getStepsForDay(db, day)).toBe(stored);

    sqlite.close();
  });

  it('syncDaySteps keeps the stored count when the service reports nothing', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);
    await upsertSteps(db, day, 5200);

    const nullService: HealthService = {
      requestPermissions: async () => false,
      stepsForDay: async () => null,
      sleepForDay: async () => null,
    };
    expect(await syncDaySteps(db, nullService, day)).toBe(5200);

    sqlite.close();
  });

  it('syncDaySteps returns null (no fabricated 0) when there is no data at all', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    expect(await syncDaySteps(db, new NullHealthService(), day)).toBeNull();
    // Nothing was written, so a later read is still the honest empty state.
    expect(await getStepsRow(db, day)).toBeNull();

    sqlite.close();
  });
});

describe('steps provenance + manual stickiness', () => {
  function makeDevice(count: number): HealthService {
    return {
      source: 'device',
      requestPermissions: async () => true,
      stepsForDay: async () => count,
      sleepForDay: async () => null,
    };
  }

  it('tags provenance: manual vs device sync', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    await setManualSteps(db, day, 8000);
    expect((await getStepsRow(db, day))?.source).toBe('manual');

    const other = new Date(2026, 5, 17);
    await syncDaySteps(db, makeDevice(6000), other);
    expect((await getStepsRow(db, other))?.source).toBe('device');

    sqlite.close();
  });

  it('manual entry is sticky — the passive sync never overwrites it', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    await setManualSteps(db, day, 8000);
    // A device sync reporting a different number must NOT replace the manual day.
    expect(await syncDaySteps(db, makeDevice(3000), day)).toBe(8000);
    const row = await getStepsRow(db, day);
    expect(row?.steps).toBe(8000);
    expect(row?.source).toBe('manual');

    sqlite.close();
  });

  it('device refresh is idempotent and overwrites a prior device/stub day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    await syncDaySteps(db, makeDevice(5000), day);
    expect(await getStepsForDay(db, day)).toBe(5000);
    // A fresh read with an updated total refreshes the same single row.
    await syncDaySteps(db, makeDevice(7200), day);
    expect(await getStepsForDay(db, day)).toBe(7200);
    expect(await listStepsDays(db)).toHaveLength(1);

    sqlite.close();
  });
});
