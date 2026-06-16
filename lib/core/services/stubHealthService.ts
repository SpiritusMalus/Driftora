import type { HealthService } from './health';

/**
 * OFFLINE STUB health source — no native HealthKit / Health Connect calls.
 *
 * It returns a deterministic, believable daily step count derived purely from
 * the calendar day, so the steps flow works end-to-end and is testable while
 * native modules / device dev builds aren't wired. The real implementation
 * (react-native-health / react-native-health-connect) swaps in behind the same
 * `HealthService` interface — see `healthProvider.ts`.
 */
export class StubHealthService implements HealthService {
  async requestPermissions(): Promise<boolean> {
    return true;
  }

  async stepsForDay(day: Date): Promise<number> {
    // Deterministic 2,500–9,400 from the calendar day (no randomness, no native
    // calls), in steps of 100 so the spread covers several insight bands.
    const seed =
      day.getFullYear() * 372 + (day.getMonth() + 1) * 31 + day.getDate();
    return 2500 + (seed % 70) * 100;
  }
}
