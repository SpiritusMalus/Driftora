import type { HealthService } from './health';
import { StubHealthService } from './stubHealthService';

let _service: HealthService | null = null;

/**
 * Returns the active health source.
 *
 * For now this is the offline [StubHealthService] (native HealthKit /
 * Health Connect modules aren't wired yet). When the real implementation lands,
 * construct it here on a device with permission and fall back to the stub
 * otherwise — callers don't change.
 */
export function getHealthService(): HealthService {
  _service ??= new StubHealthService();
  return _service;
}
