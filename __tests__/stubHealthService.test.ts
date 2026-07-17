import { describe, expect, it } from '@jest/globals';

import { StubHealthService } from '@/lib/core/services/stubHealthService';

describe('StubHealthService (offline stub)', () => {
  it('grants permission without a native prompt', async () => {
    expect(await new StubHealthService().requestPermissions()).toBe(true);
  });

  it('returns a deterministic, believable integer count for a day', async () => {
    const svc = new StubHealthService();
    const a = await svc.stepsForDay(new Date(2026, 5, 16));
    const b = await svc.stepsForDay(new Date(2026, 5, 16));
    expect(a).toBe(b); // deterministic — same day, same count
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(2500);
    expect(a).toBeLessThanOrEqual(9400);
  });

  it('varies across different days', async () => {
    const svc = new StubHealthService();
    const counts = new Set<number>();
    for (let d = 1; d <= 28; d++) {
      counts.add(await svc.stepsForDay(new Date(2026, 5, d)));
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it('returns deterministic daily weigh-ins in a plausible band', async () => {
    const svc = new StubHealthService();
    const start = new Date(2026, 5, 10);
    const end = new Date(2026, 5, 16);
    const a = await svc.weightSamplesForRange(start, end);
    const b = await svc.weightSamplesForRange(start, end);
    expect(a).toEqual(b); // deterministic
    expect(a).toHaveLength(7); // one weigh-in per day
    for (const s of a) {
      expect(s.value).toBeGreaterThanOrEqual(74);
      expect(s.value).toBeLessThanOrEqual(80);
    }
  });

  it('returns body fat only on some days (exercises the fat-less path), 0–100 scale', async () => {
    const svc = new StubHealthService();
    const fats = await svc.bodyFatSamplesForRange(new Date(2026, 5, 1), new Date(2026, 5, 28));
    expect(fats.length).toBeGreaterThan(0);
    expect(fats.length).toBeLessThan(28); // deliberately not every day
    for (const s of fats) {
      expect(s.value).toBeGreaterThanOrEqual(3);
      expect(s.value).toBeLessThanOrEqual(70);
    }
  });

  it('emits a deterministic session every third day with plausible windows', async () => {
    const svc = new StubHealthService();
    let sessions = 0;
    for (let d = 1; d <= 30; d++) {
      const list = await svc.workoutSessionsForDay(new Date(2026, 5, d));
      const again = await svc.workoutSessionsForDay(new Date(2026, 5, d));
      expect(list).toEqual(again); // deterministic
      sessions += list.length;
      for (const s of list) {
        expect(new Date(s.end).getTime()).toBeGreaterThan(new Date(s.start).getTime());
        expect(s.externalId).toContain('stub-');
      }
    }
    expect(sessions).toBe(10); // every 3rd calendar day in a 30-day month
  });

  it('returns deterministic night signals with partial nulls', async () => {
    const svc = new StubHealthService();
    const a = await svc.bodySignalsForDay(new Date(2026, 5, 16));
    const b = await svc.bodySignalsForDay(new Date(2026, 5, 16));
    expect(a).toEqual(b);
    expect(a.restingBpm).toBeGreaterThanOrEqual(50);
    expect(a.restingBpm).toBeLessThanOrEqual(65);
    expect(a.hrvMethod).toBe('rmssd');
    // Some day in a month must miss SpO₂ and most miss VO₂max (partial-null UI).
    const bags = await Promise.all(
      Array.from({ length: 28 }, (_, i) => svc.bodySignalsForDay(new Date(2026, 5, i + 1))),
    );
    expect(bags.some((x) => x.spo2Pct == null)).toBe(true);
    expect(bags.some((x) => x.vo2Max == null)).toBe(true);
  });
});
