import type { DeviceWorkoutSession, HealthSample, HealthService } from './health';
import { dayKey } from '../db/steps';

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
  readonly source = 'stub' as const;

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

  async sleepForDay(day: Date): Promise<number> {
    // Deterministic 5h00–8h50 (300–530 min) from the calendar day, in 10-min
    // steps, so the spread crosses several sleep bands. A different seed mix
    // than steps so sleep and steps don't move in lockstep (the Body↔Mind
    // pairings stay genuinely independent).
    const seed =
      day.getFullYear() * 145 + (day.getMonth() + 1) * 17 + day.getDate() * 7;
    return 300 + (seed % 24) * 10;
  }

  async requestExtendedPermissions(): Promise<boolean> {
    return true;
  }

  /// Deterministic morning weigh-in per day: 74.0–79.9 kg drifting with the
  /// calendar (0.1-kg steps), stamped 07:30 local. One sample per day.
  async weightSamplesForRange(start: Date, end: Date): Promise<HealthSample[]> {
    const samples: HealthSample[] = [];
    for (const day of eachDay(start, end)) {
      const seed =
        day.getFullYear() * 372 + (day.getMonth() + 1) * 31 + day.getDate();
      const kg = 74 + (seed % 60) / 10;
      samples.push({ at: at(day, 7, 30), value: kg });
    }
    return samples;
  }

  /// Deterministic body-fat % every SECOND day (scales don't always catch
  /// impedance — exercises the null path), 18.0–27.5 in 0.5 steps.
  async bodyFatSamplesForRange(start: Date, end: Date): Promise<HealthSample[]> {
    const samples: HealthSample[] = [];
    for (const day of eachDay(start, end)) {
      const seed =
        day.getFullYear() * 53 + (day.getMonth() + 1) * 13 + day.getDate() * 3;
      if (seed % 2 !== 0) continue;
      samples.push({ at: at(day, 7, 31), value: 18 + (seed % 20) * 0.5 });
    }
    return samples;
  }

  /// One deterministic evening session every THIRD calendar day, 18:00–18:40,
  /// cycling run → strength → walk — so a dev build exercises the import, the
  /// step subtraction AND both kcal paths without a watch.
  async workoutSessionsForDay(day: Date): Promise<DeviceWorkoutSession[]> {
    if (day.getDate() % 3 !== 0) return [];
    const types = ['run', 'strength', 'walk'] as const;
    return [
      {
        externalId: `stub-${dayKey(day)}`,
        start: at(day, 18, 0),
        end: at(day, 18, 40),
        type: types[Math.floor(day.getDate() / 3) % 3],
        title: null,
        deviceKcal: null,
        origin: 'stub',
      },
    ];
  }

  /// Deterministic window steps, scaled to the window length (≈120 шагов/мин
  /// ходьбы-бега) with a per-day wobble — enough for the subtraction to move.
  async stepsInWindow(start: Date, end: Date): Promise<number> {
    const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    const seed = start.getFullYear() * 91 + (start.getMonth() + 1) * 11 + start.getDate() * 5;
    return Math.round(minutes * (80 + (seed % 9) * 10));
  }

  /// Measured window energy on EVEN days only — odd days exercise the honest
  /// «≈MET» fallback path end-to-end.
  async activeKcalInWindow(start: Date, end: Date): Promise<number | null> {
    if (start.getDate() % 2 !== 0) return null;
    const minutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    return Math.round(minutes * 8);
  }
}

/// Local days whose calendar date falls inside [start, end], oldest first.
function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = dayKey(end);
  while (dayKey(cursor) <= last) {
    days.push(new Date(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/// ISO timestamp for HH:mm local on the given day.
function at(day: Date, h: number, m: number): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).toISOString();
}
