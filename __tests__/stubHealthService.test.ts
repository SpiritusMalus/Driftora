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
});
