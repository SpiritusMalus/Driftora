import type { HealthAvailability, HealthService } from './health';
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

  /// No native health module in this build → the screen says "not available in
  /// this build" rather than mislabelling it as a permission denial.
  async availability(): Promise<HealthAvailability> {
    return 'unsupported';
  }

  async requestPermissions(): Promise<boolean> {
    return false;
  }

  async requestExtendedPermissions(): Promise<boolean> {
    return false;
  }

  async stepsForDay(): Promise<number | null> {
    return null;
  }

  async sleepForDay(): Promise<number | null> {
    return null;
  }

  async weightSamplesForRange(): Promise<null> {
    return null;
  }

  async bodyFatSamplesForRange(): Promise<null> {
    return null;
  }
}

/**
 * Picks the OFFLINE health source: the deterministic [StubHealthService] in dev /
 * Expo Go (so its fake counts can never reach production), else the honest
 * [NullHealthService] ("no data"). Pure + injectable so the honesty gate is
 * unit-testable. The REAL device source is wired separately in
 * [getHealthService] — it needs native modules absent from jest / Expo Go.
 */
export function selectHealthService(isDev: boolean): HealthService {
  return isDev ? new StubHealthService() : new NullHealthService();
}

/**
 * Tries to construct the real device source (HealthKit / Health Connect). Loaded
 * LAZILY so the native packages are never touched in dev / jest. Returns null if
 * the native modules aren't installed/linked (e.g. Expo Go) — the caller then
 * falls back to the honest no-data source.
 */
function tryDeviceHealthService(): HealthService | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./deviceHealthService') as typeof import('./deviceHealthService');
    return mod.createDeviceHealthService();
  } catch {
    return null;
  }
}

/**
 * Returns the active health source (memoized). Dev → deterministic stub. A real
 * build → the native device source (HealthKit / Health Connect) when its module
 * is present, else the honest no-data source. Callers don't change.
 */
export function getHealthService(): HealthService {
  if (_service) return _service;
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  _service = isDev ? selectHealthService(true) : (tryDeviceHealthService() ?? new NullHealthService());
  return _service;
}
