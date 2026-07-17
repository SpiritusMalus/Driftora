import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { getHealthDay, upsertHealthDay } from '@/lib/core/db/healthDays';
import { syncDayBodySignals } from '@/lib/core/db/healthSync';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import type { DeviceBodySignals, HealthService } from '@/lib/core/services/health';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

const empty: DeviceBodySignals = {
  restingBpm: null,
  hrvMs: null,
  hrvMethod: null,
  spo2Pct: null,
  respRate: null,
  vo2Max: null,
};

describe('health_days', () => {
  it('stores a day of signals with per-metric nullability and the HRV method', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const wrote = await upsertHealthDay(db, '2026-07-16', {
      ...empty,
      restingBpm: 54.4,
      hrvMs: 48.5,
      hrvMethod: 'sdnn',
      respRate: 14.5,
    });

    expect(wrote).toBe(true);
    const row = await getHealthDay(db, '2026-07-16');
    expect(row).toMatchObject({
      restingBpm: 54, // rounded to whole bpm
      hrvMs: 48.5,
      hrvMethod: 'sdnn',
      respRate: 14.5,
      spo2Pct: null,
      vo2max: null,
    });
    sqlite.close();
  });

  it('skips an all-null bag (no empty rows) and updates on a re-sync', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    expect(await upsertHealthDay(db, '2026-07-16', empty)).toBe(false);
    expect(await getHealthDay(db, '2026-07-16')).toBeNull();

    await upsertHealthDay(db, '2026-07-16', { ...empty, restingBpm: 60 });
    await upsertHealthDay(db, '2026-07-16', { ...empty, restingBpm: 56, spo2Pct: 96 });
    const row = await getHealthDay(db, '2026-07-16');
    expect(row?.restingBpm).toBe(56); // re-sync corrects, not stacks
    expect(row?.spo2Pct).toBe(96);
    sqlite.close();
  });

  it('drops the stored hrv method when a later sync has no HRV', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertHealthDay(db, '2026-07-16', { ...empty, hrvMs: 40, hrvMethod: 'rmssd' });
    await upsertHealthDay(db, '2026-07-16', { ...empty, restingBpm: 60 });
    const row = await getHealthDay(db, '2026-07-16');
    expect(row?.hrvMs).toBeNull();
    expect(row?.hrvMethod).toBeNull(); // a method without a value is noise
    sqlite.close();
  });
});

describe('syncDayBodySignals', () => {
  it('writes through the service and degrades honestly when it cannot read', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const svc: HealthService = {
      async requestPermissions() {
        return true;
      },
      async stepsForDay() {
        return null;
      },
      async sleepForDay() {
        return null;
      },
      async bodySignalsForDay() {
        return { ...empty, restingBpm: 52, vo2Max: 44.2 };
      },
    };
    expect(await syncDayBodySignals(db, svc, new Date(2026, 6, 16))).toBe(true);
    expect((await getHealthDay(db, '2026-07-16'))?.vo2max).toBe(44.2);

    const nullSvc: HealthService = {
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
    expect(await syncDayBodySignals(db, nullSvc, new Date(2026, 6, 17))).toBe(false);
    expect(await getHealthDay(db, '2026-07-17')).toBeNull();
    sqlite.close();
  });
});
