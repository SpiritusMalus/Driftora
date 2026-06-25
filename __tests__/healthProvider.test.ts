import { describe, expect, it } from '@jest/globals';

import {
  NullHealthService,
  selectHealthService,
} from '@/lib/core/services/healthProvider';
import { StubHealthService } from '@/lib/core/services/stubHealthService';

/// The honesty gate: the deterministic stub may run ONLY in dev/Expo Go, so its
/// fabricated step/sleep counts can never reach a production build — there the
/// app reports "no data" until real device data or a manual entry exists.
/// Pure (no DB), so it runs in the sandbox unlike the sqlite-backed steps suite.
describe('health source honesty gate (no fake steps in prod)', () => {
  it('uses the deterministic stub only in dev', () => {
    const dev = selectHealthService(true);
    expect(dev).toBeInstanceOf(StubHealthService);
    expect(dev.source).toBe('stub');
  });

  it('uses the honest no-data source in production (never the stub)', async () => {
    const prod = selectHealthService(false);
    expect(prod).toBeInstanceOf(NullHealthService);
    expect(prod).not.toBeInstanceOf(StubHealthService);
    // It fabricates nothing — both passive signals report "no data".
    expect(await prod.stepsForDay(new Date(2026, 5, 16))).toBeNull();
    expect(await prod.sleepForDay(new Date(2026, 5, 16))).toBeNull();
    // And it never claims permission it doesn't have.
    expect(await prod.requestPermissions()).toBe(false);
  });
});
