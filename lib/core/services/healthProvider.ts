import type { HealthService } from './health';
import { StubHealthService } from './stubHealthService';

let _service: HealthService | null = null;

/**
 * Honest "no data" source for production until the native HealthKit /
 * Health Connect modules are wired. It reports nothing rather than fabricating
 * a step/sleep count — callers then show "no data" and the manual-entry path,
 * never a fake number.
 */
export class NullHealthService implements HealthService {
  readonly source = 'device' as const;

  async requestPermissions(): Promise<boolean> {
    return false;
  }

  async stepsForDay(): Promise<number | null> {
    return null;
  }

  async sleepForDay(): Promise<number | null> {
    return null;
  }
}

/**
 * Picks the health source. The deterministic [StubHealthService] is restricted
 * to dev / Expo Go so its fake counts can never reach production; a real build
 * gets [NullHealthService] (honest "no data") until the native modules land —
 * at which point construct the real impl here when its module is present and
 * fall back to [NullHealthService] otherwise. Pure + injectable so the gate is
 * unit-testable.
 */
export function selectHealthService(isDev: boolean): HealthService {
  return isDev ? new StubHealthService() : new NullHealthService();
}

/**
 * Returns the active health source (memoized). Stub only in dev; honest
 * "no data" in production. Callers don't change when the real native impl lands.
 */
export function getHealthService(): HealthService {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  _service ??= selectHealthService(isDev);
  return _service;
}
