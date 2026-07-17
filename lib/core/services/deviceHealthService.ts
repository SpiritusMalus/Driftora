import { Platform } from 'react-native';

import { dayKey } from '../db/steps';
import type { HealthAvailability, HealthSample, HealthService } from './health';
import { asleepMinutes, type SleepSample } from './sleepSamples';

/// REAL device health source — reads steps + sleep from the OS health store via
/// `react-native-health` (iOS HealthKit) and `react-native-health-connect`
/// (Android Health Connect). Both are native modules that only exist in a dev /
/// production build, never in Expo Go or jest — so this file is loaded LAZILY by
/// `healthProvider.getHealthService` (a `require` inside try/catch) and the
/// native packages are pulled in with `require`, not a static `import`. That
/// keeps `tsc`, jest and the dev (stub) path free of any native dependency: if
/// the packages aren't installed, construction throws and the provider falls back
/// to the honest NullHealthService.
///
/// To activate on a device: `npm install` (pulls the two packages listed in
/// package.json), prebuild/EAS so the pods + Health Connect SDK link, and grant
/// the OS permission (the steps screen requests it). iOS config (entitlement +
/// NSHealthShareUsageDescription) and Android config (READ_STEPS + the Health
/// Connect plugin) live in app.json.

// Minimal shapes for the two native APIs — declared locally so this file needs
// no @types from the (optionally installed) packages.
interface HkSample {
  value: number;
  startDate: string;
  endDate: string;
}
interface AppleHealthKit {
  initHealthKit(perms: unknown, cb: (err: string | null) => void): void;
  getStepCount(opts: { date: string }, cb: (err: string | null, res: { value: number }) => void): void;
  getSleepSamples(
    opts: { startDate: string; endDate: string },
    cb: (err: string | null, res: SleepSample[]) => void,
  ): void;
  getWeightSamples(
    opts: { startDate: string; endDate: string; unit?: string; ascending?: boolean },
    cb: (err: string | null, res: HkSample[]) => void,
  ): void;
  getBodyFatPercentageSamples(
    opts: { startDate: string; endDate: string; ascending?: boolean },
    cb: (err: string | null, res: HkSample[]) => void,
  ): void;
  Constants: { Permissions: Record<string, string> };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/// iOS HealthKit via react-native-health. Permission is requested once
/// (`initHealthKit`); reads return null on any error so callers degrade to "no
/// data" rather than a fabricated count.
///
/// TWO permission scopes, deliberately split: the BASE scope (steps+sleep) is
/// what the lazy re-request inside stepsForDay/sleepForDay asks for — exactly
/// as before this file learned extended reads. The EXTENDED scope adds weight,
/// body fat, workouts and vitals and is requested ONLY via
/// requestExtendedPermissions (an explicit connect tap). Folding the new types
/// into the base list would surprise every existing user with a HealthKit
/// sheet on next app open (Home syncs steps on focus).
class IosHealthService implements HealthService {
  readonly source = 'device' as const;
  private hk: AppleHealthKit;
  private initialized = false;
  private fullInitialized = false;

  constructor() {
    // `require` (not import) so missing package → throw → provider falls back.
    this.hk = (require('react-native-health') as { default: AppleHealthKit }).default;
  }

  private get permissions() {
    const P = this.hk.Constants.Permissions;
    return { permissions: { read: [P.StepCount, P.SleepAnalysis], write: [] } };
  }

  private get fullPermissions() {
    const P = this.hk.Constants.Permissions;
    return {
      permissions: {
        read: [
          P.StepCount,
          P.SleepAnalysis,
          P.Weight,
          P.BodyFatPercentage,
          P.Workout,
          P.ActiveEnergyBurned,
          P.RestingHeartRate,
          P.HeartRateVariability,
          P.OxygenSaturation,
          P.RespiratoryRate,
          P.Vo2Max,
        ],
        write: [],
      },
    };
  }

  async requestPermissions(): Promise<boolean> {
    return new Promise((resolve) => {
      this.hk.initHealthKit(this.permissions, (err) => {
        this.initialized = !err;
        resolve(!err);
      });
    });
  }

  async requestExtendedPermissions(): Promise<boolean> {
    return new Promise((resolve) => {
      this.hk.initHealthKit(this.fullPermissions, (err) => {
        this.fullInitialized = !err;
        this.initialized = this.initialized || !err;
        resolve(!err);
      });
    });
  }

  /// Extended reads re-init with the full scope. Safe at cold start: this is
  /// only reached when the user already connected (settings flag), so every
  /// type is "determined" and initHealthKit shows no sheet.
  private async ensureFull(): Promise<boolean> {
    if (this.fullInitialized) return true;
    return this.requestExtendedPermissions();
  }

  async weightSamplesForRange(start: Date, end: Date): Promise<HealthSample[] | null> {
    if (!(await this.ensureFull())) return null;
    return new Promise((resolve) => {
      // Explicit unit: without it react-native-health returns POUNDS.
      this.hk.getWeightSamples(
        { startDate: start.toISOString(), endDate: end.toISOString(), unit: 'gram', ascending: true },
        (err, samples) => {
          if (err || !Array.isArray(samples)) return resolve(null);
          resolve(
            samples
              .filter((s) => Number.isFinite(s?.value) && !!s?.startDate)
              .map((s) => ({ at: s.startDate, value: s.value / 1000 })),
          );
        },
      );
    });
  }

  async bodyFatSamplesForRange(start: Date, end: Date): Promise<HealthSample[] | null> {
    if (!(await this.ensureFull())) return null;
    return new Promise((resolve) => {
      this.hk.getBodyFatPercentageSamples(
        { startDate: start.toISOString(), endDate: end.toISOString(), ascending: true },
        (err, samples) => {
          if (err || !Array.isArray(samples)) return resolve(null);
          resolve(
            samples
              .filter((s) => Number.isFinite(s?.value) && !!s?.startDate)
              // HealthKit sample queries return the raw 0–1 fraction (only the
              // getLatest… variant multiplies by 100 natively) — normalize here.
              .map((s) => ({ at: s.startDate, value: s.value <= 1 ? s.value * 100 : s.value })),
          );
        },
      );
    });
  }

  async stepsForDay(day: Date): Promise<number | null> {
    if (!this.initialized && !(await this.requestPermissions())) return null;
    return new Promise((resolve) => {
      // HealthKit's getStepCount returns the total for the calendar day of `date`.
      this.hk.getStepCount({ date: startOfDay(day).toISOString() }, (err, res) => {
        resolve(err || res == null ? null : Math.round(res.value));
      });
    });
  }

  async sleepForDay(day: Date): Promise<number | null> {
    if (!this.initialized && !(await this.requestPermissions())) return null;
    // Night ending on `day`: from noon the day before to noon on `day`.
    const end = new Date(startOfDay(day).getTime() + 12 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - DAY_MS);
    return new Promise((resolve) => {
      this.hk.getSleepSamples(
        { startDate: start.toISOString(), endDate: end.toISOString() },
        (err, samples) => {
          if (err || !Array.isArray(samples)) return resolve(null);
          const minutes = asleepMinutes(samples);
          resolve(minutes > 0 ? Math.round(minutes) : null);
        },
      );
    });
  }
}

/// Android Health Connect via react-native-health-connect. The module is async
/// throughout; every read is wrapped so a denied permission / missing provider
/// degrades to null.
class AndroidHealthService implements HealthService {
  readonly source = 'device' as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private hc: any;
  private ready = false;

  constructor() {
    this.hc = require('react-native-health-connect');
  }

  private async ensure(): Promise<boolean> {
    if (this.ready) return true;
    try {
      const ok = await this.hc.initialize();
      this.ready = !!ok;
      return this.ready;
    } catch {
      return false;
    }
  }

  /// Probe Health Connect's SDK status BEFORE requesting permission. This is why
  /// "Connect" could silently do nothing: on a device without an up-to-date
  /// Health Connect provider, `requestPermission` never launches its UI. Mapping
  /// `getSdkStatus` lets the screen guide the user (install / update) instead.
  async availability(): Promise<HealthAvailability> {
    try {
      const status = await this.hc.getSdkStatus();
      const S = this.hc.SdkAvailabilityStatus ?? {};
      if (status === S.SDK_AVAILABLE) return 'available';
      if (status === S.SDK_AVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update_required';
      return 'unavailable';
    } catch {
      // getSdkStatus itself unavailable → the module/provider isn't usable here.
      return 'unavailable';
    }
  }

  async requestPermissions(): Promise<boolean> {
    if (!(await this.ensure())) return false;
    try {
      const granted = await this.hc.requestPermission([
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'SleepSession' },
      ]);
      return Array.isArray(granted) && granted.length > 0;
    } catch {
      return false;
    }
  }

  /// The extended read set (weight/body-fat/workouts/vitals) on top of the base
  /// steps+sleep. Health Connect grants are per-record-type, so a partial grant
  /// is fine — each read below degrades to null on its own.
  async requestExtendedPermissions(): Promise<boolean> {
    if (!(await this.ensure())) return false;
    try {
      const granted = await this.hc.requestPermission([
        { accessType: 'read', recordType: 'Steps' },
        { accessType: 'read', recordType: 'SleepSession' },
        { accessType: 'read', recordType: 'Weight' },
        { accessType: 'read', recordType: 'BodyFat' },
        { accessType: 'read', recordType: 'ExerciseSession' },
        { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
        { accessType: 'read', recordType: 'RestingHeartRate' },
        { accessType: 'read', recordType: 'HeartRateVariabilityRmssd' },
        { accessType: 'read', recordType: 'OxygenSaturation' },
        { accessType: 'read', recordType: 'RespiratoryRate' },
        { accessType: 'read', recordType: 'Vo2Max' },
      ]);
      return Array.isArray(granted) && granted.length > 0;
    } catch {
      return false;
    }
  }

  /// Range read of a record type mapped to timestamped samples; null on any
  /// failure (missing grant, provider error) — honest degradation per metric.
  private async readSamples(
    recordType: string,
    start: Date,
    end: Date,
    pick: (r: unknown) => { at: string | undefined; value: number },
  ): Promise<HealthSample[] | null> {
    if (!(await this.ensure())) return null;
    try {
      const res = await this.hc.readRecords(recordType, {
        timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
      });
      const records: unknown[] = res?.records ?? [];
      const samples: HealthSample[] = [];
      for (const r of records) {
        const { at, value } = pick(r);
        if (at && Number.isFinite(value)) samples.push({ at, value });
      }
      return samples;
    } catch {
      return null;
    }
  }

  async weightSamplesForRange(start: Date, end: Date): Promise<HealthSample[] | null> {
    return this.readSamples('Weight', start, end, (r) => {
      const rec = r as { time?: string; weight?: { inKilograms?: number } };
      return { at: rec.time, value: Number(rec.weight?.inKilograms ?? NaN) };
    });
  }

  async bodyFatSamplesForRange(start: Date, end: Date): Promise<HealthSample[] | null> {
    // BodyFatRecordResult.percentage is already 0–100 (unlike HealthKit's fraction).
    return this.readSamples('BodyFat', start, end, (r) => {
      const rec = r as { time?: string; percentage?: number };
      return { at: rec.time, value: Number(rec.percentage ?? NaN) };
    });
  }

  private async readSum(recordType: string, start: Date, end: Date, pick: (r: unknown) => number): Promise<number | null> {
    if (!(await this.ensure())) return null;
    try {
      const res = await this.hc.readRecords(recordType, {
        timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
      });
      const records: unknown[] = res?.records ?? [];
      if (records.length === 0) return null;
      const total = records.reduce((sum: number, r) => sum + pick(r), 0);
      return total > 0 ? Math.round(total) : null;
    } catch {
      return null;
    }
  }

  async stepsForDay(day: Date): Promise<number | null> {
    const start = startOfDay(day);
    const end = new Date(start.getTime() + DAY_MS);
    // Prefer the AGGREGATE API: Health Connect dedups overlapping sources there
    // (phone + watch both writing Steps would double-count in a raw-record sum).
    if (await this.ensure()) {
      try {
        const res = await this.hc.aggregateRecord({
          recordType: 'Steps',
          timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
        });
        const total = Number(res?.COUNT_TOTAL ?? 0);
        if (total > 0) return Math.round(total);
      } catch {
        // Fall through to the raw-record sum below.
      }
    }
    return this.readSum('Steps', start, end, (r) => Number((r as { count?: number }).count ?? 0));
  }

  async sleepForDay(day: Date): Promise<number | null> {
    const end = new Date(startOfDay(day).getTime() + 12 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - DAY_MS);
    if (!(await this.ensure())) return null;
    try {
      const res = await this.hc.readRecords('SleepSession', {
        timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
      });
      const records: unknown[] = res?.records ?? [];
      if (records.length === 0) return null;
      // Sessions from several writers (phone + watch + apps) can OVERLAP — sum
      // the merged union, not the raw durations, mirroring the iOS de-dup: a
      // naive sum reads a 7 h night with two sources as 13 h+.
      const samples: SleepSample[] = [];
      for (const r of records) {
        const s = r as { startTime?: string; endTime?: string };
        if (s.startTime && s.endTime) samples.push({ startDate: s.startTime, endDate: s.endTime });
      }
      const minutes = asleepMinutes(samples);
      return minutes > 0 ? Math.round(minutes) : null;
    } catch {
      return null;
    }
  }
}

/// Local midnight for the given day (HealthKit/Health Connect read windows).
function startOfDay(day: Date): Date {
  const [y, m, d] = dayKey(day).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/// Constructs the platform-native health service. Throws if the matching native
/// module isn't installed/linked — callers (getHealthService) catch and fall
/// back to NullHealthService. Returns null on web / unsupported platforms.
export function createDeviceHealthService(): HealthService | null {
  if (Platform.OS === 'ios') return new IosHealthService();
  if (Platform.OS === 'android') return new AndroidHealthService();
  return null;
}
