import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import {
  lastSamplePerDay,
  latestDeviceBodyFat,
  latestWeight,
  listWeights,
  syncWeighIns,
  upsertDeviceWeight,
  upsertWeight,
} from '@/lib/core/db/weight';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';
import type { HealthSample, HealthService } from '@/lib/core/services/health';

describe('summarizeWeightTrend', () => {
  it('needs at least two points', () => {
    expect(summarizeWeightTrend([])).toBeNull();
    expect(summarizeWeightTrend([{ date: '2026-06-01', weightKg: 80 }])).toBeNull();
  });

  it('reports a downward trend with span and rounded delta', () => {
    const points: WeightPoint[] = [
      { date: '2026-06-15', weightKg: 78.5 },
      { date: '2026-06-01', weightKg: 80 }, // unsorted on purpose
    ];
    expect(summarizeWeightTrend(points)).toEqual({
      latestKg: 78.5,
      deltaKg: -1.5,
      spanDays: 14,
      direction: 'down',
    });
  });

  it('calls a sub-threshold change "steady"', () => {
    const points: WeightPoint[] = [
      { date: '2026-06-01', weightKg: 80 },
      { date: '2026-06-03', weightKg: 80.2 },
    ];
    expect(summarizeWeightTrend(points)).toMatchObject({ direction: 'steady', deltaKg: 0.2 });
  });

  it('reports an upward trend', () => {
    const points: WeightPoint[] = [
      { date: '2026-06-01', weightKg: 80 },
      { date: '2026-06-10', weightKg: 81.4 },
    ];
    expect(summarizeWeightTrend(points)).toMatchObject({ direction: 'up', deltaKg: 1.4, spanDays: 9 });
  });
});

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

describe('weight db', () => {
  it('keeps one row per day and corrects on a re-weigh', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await upsertWeight(db, '2026-06-17', 80);
    await upsertWeight(db, '2026-06-17', 79.5); // same day → correction, not a new row

    const all = await listWeights(db);
    expect(all).toHaveLength(1);
    expect(all[0].weightKg).toBe(79.5);
    sqlite.close();
  });

  it('orders newest-first and reports the latest by date', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await upsertWeight(db, '2026-06-01', 80);
    await upsertWeight(db, '2026-06-17', 78);
    await upsertWeight(db, '2026-06-10', 79);

    const all = await listWeights(db);
    expect(all.map((w) => w.date)).toEqual(['2026-06-17', '2026-06-10', '2026-06-01']);
    expect((await latestWeight(db))?.weightKg).toBe(78);
    sqlite.close();
  });

  it('tags manual rows and never overwrites them from the device', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await upsertWeight(db, '2026-06-17', 80); // manual
    await upsertDeviceWeight(db, '2026-06-17', 79.2, 23.5); // scale, same day → sticky

    const all = await listWeights(db);
    expect(all).toHaveLength(1);
    expect(all[0].weightKg).toBe(80);
    expect(all[0].source).toBe('manual');
    expect(all[0].bodyFatPct).toBeNull();
    sqlite.close();
  });

  it('lets the device fill an empty day and a manual save reclaim it (keeping the measured fat)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await upsertDeviceWeight(db, '2026-06-17', 79.2, 23.5);
    let row = (await listWeights(db))[0];
    expect(row.source).toBe('device');
    expect(row.bodyFatPct).toBe(23.5);

    // The user corrects the kilos by hand — provenance flips to manual (sticky
    // for future syncs), but the impedance measurement is not erased.
    await upsertWeight(db, '2026-06-17', 79.0);
    row = (await listWeights(db))[0];
    expect(row.weightKg).toBe(79.0);
    expect(row.source).toBe('manual');
    expect(row.bodyFatPct).toBe(23.5);
    sqlite.close();
  });
});

/// A fake device: returns the given weight/fat samples, tracks nothing else.
function fakeService(weights: HealthSample[], fats: HealthSample[] | null = null): HealthService {
  return {
    source: 'device',
    async requestPermissions() {
      return true;
    },
    async stepsForDay() {
      return null;
    },
    async sleepForDay() {
      return null;
    },
    async weightSamplesForRange() {
      return weights;
    },
    async bodyFatSamplesForRange() {
      return fats;
    },
  };
}

describe('lastSamplePerDay', () => {
  it('keeps the LAST measurement of each local day and drops garbage', () => {
    const grouped = lastSamplePerDay([
      { at: '2026-06-17T07:00:00.000Z', value: 80.4 },
      { at: '2026-06-17T21:15:00.000Z', value: 79.8 }, // later same day → wins
      { at: 'not-a-date', value: 70 },
      { at: '2026-06-18T07:00:00.000Z', value: NaN },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get('2026-06-17')?.value).toBe(79.8);
  });
});

describe('syncWeighIns', () => {
  const now = new Date(2026, 5, 18, 12, 0); // local 2026-06-18

  it('writes one device row per day (last sample wins) with its body fat', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const day17 = (h: number) => new Date(2026, 5, 17, h).toISOString();
    const day18 = (h: number) => new Date(2026, 5, 18, h).toISOString();
    const written = await syncWeighIns(
      db,
      fakeService(
        [
          { at: day17(7), value: 80.4 },
          { at: day17(21), value: 79.8 },
          { at: day18(7), value: 79.5 },
        ],
        [{ at: day17(7), value: 23.5 }],
      ),
      2,
      now,
    );

    expect(written).toBe(2);
    const all = await listWeights(db);
    expect(all.map((w) => [w.date, w.weightKg, w.bodyFatPct, w.source])).toEqual([
      ['2026-06-18', 79.5, null, 'device'],
      ['2026-06-17', 79.8, 23.5, 'device'],
    ]);
    expect((await latestDeviceBodyFat(db))?.date).toBe('2026-06-17');
    sqlite.close();
  });

  it('skips manual days, implausible readings and out-of-band fat', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    await upsertWeight(db, '2026-06-17', 80); // manual → sticky

    const written = await syncWeighIns(
      db,
      fakeService(
        [
          { at: new Date(2026, 5, 17, 7).toISOString(), value: 79.2 }, // manual day → skipped
          { at: new Date(2026, 5, 18, 7).toISOString(), value: 7.9 }, // slipped decimal → dropped
        ],
        null,
      ),
      2,
      now,
    );

    expect(written).toBe(0); // sticky skip + dropped garbage → nothing written
    const all = await listWeights(db);
    expect(all).toHaveLength(1);
    expect(all[0].source).toBe('manual');
    expect(all[0].weightKg).toBe(80);
    sqlite.close();
  });

  it('is a honest no-op when the service cannot read weight', async () => {
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
    expect(await syncWeighIns(db, svc, 30, now)).toBe(0);
    expect(await listWeights(db)).toHaveLength(0);
    sqlite.close();
  });
});
