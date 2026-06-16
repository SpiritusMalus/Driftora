import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { latestWeight, listWeights, upsertWeight } from '@/lib/core/db/weight';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';

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
});
