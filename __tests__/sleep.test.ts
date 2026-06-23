import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { getSleepForDay, syncDaySleep, upsertSleep } from '@/lib/core/db/sleep';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { sleepBand, sleepHours, type SleepBand } from '@/lib/core/insights/sleepInsight';
import type { HealthService } from '@/lib/core/services/health';
import { StubHealthService } from '@/lib/core/services/stubHealthService';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

// ---- pure insight ---------------------------------------------------------

describe('sleepBand', () => {
  it('classifies minutes into evidence-based bands (no marketing thresholds)', () => {
    const cases: [number | null, SleepBand][] = [
      [null, 'unknown'],
      [0, 'unknown'],
      [-10, 'unknown'],
      [359, 'very_short'], // < 6h
      [360, 'short'], // 6h
      [419, 'short'],
      [420, 'ample'], // 7h, lower edge
      [540, 'ample'], // 9h, upper edge
      [541, 'long'], // > 9h
    ];
    for (const [min, band] of cases) expect(sleepBand(min)).toBe(band);
  });
});

describe('sleepHours', () => {
  it('formats minutes as one-decimal hours', () => {
    expect(sleepHours(450)).toBe(7.5);
    expect(sleepHours(480)).toBe(8);
    expect(sleepHours(395)).toBe(6.6);
  });
});

// ---- storage --------------------------------------------------------------

describe('sleep storage (sleep_days)', () => {
  it('returns null before anything is synced (no data, not zero)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    expect(await getSleepForDay(db, new Date(2026, 5, 16))).toBeNull();
    sqlite.close();
  });

  it('upsert stores then overwrites the same day (one row per date)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    await upsertSleep(db, day, 420);
    expect(await getSleepForDay(db, day)).toBe(420);

    await upsertSleep(db, day, 510); // same day → replace
    expect(await getSleepForDay(db, day)).toBe(510);

    const rows = await db.select().from(schema.sleepDays);
    expect(rows).toHaveLength(1);
    sqlite.close();
  });

  it('syncDaySleep writes the service minutes and returns them', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);

    const stored = await syncDaySleep(db, new StubHealthService(), day);
    expect(stored).toBe(await new StubHealthService().sleepForDay(day));
    expect(await getSleepForDay(db, day)).toBe(stored);
    sqlite.close();
  });

  it('keeps the stored value when the service reports nothing', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16);
    await upsertSleep(db, day, 430);

    const nullService: HealthService = {
      requestPermissions: async () => false,
      stepsForDay: async () => null,
      sleepForDay: async () => null,
    };
    expect(await syncDaySleep(db, nullService, day)).toBe(430);
    sqlite.close();
  });
});

describe('StubHealthService.sleepForDay', () => {
  it('is deterministic and lands in a believable 300–530 min range', async () => {
    const svc = new StubHealthService();
    const day = new Date(2026, 5, 16);
    const a = await svc.sleepForDay(day);
    const b = await svc.sleepForDay(new Date(2026, 5, 16));
    expect(a).toBe(b); // no randomness
    expect(a).toBeGreaterThanOrEqual(300);
    expect(a).toBeLessThanOrEqual(530);
    expect(a % 10).toBe(0);
  });
});
