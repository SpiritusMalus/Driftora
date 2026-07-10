import { Platform } from 'react-native';

import { dayKey } from '../db/steps';
import type { HealthAvailability, HealthService } from './health';

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
interface AppleHealthKit {
  initHealthKit(perms: unknown, cb: (err: string | null) => void): void;
  getStepCount(opts: { date: string }, cb: (err: string | null, res: { value: number }) => void): void;
  getSleepSamples(
    opts: { startDate: string; endDate: string },
    cb: (err: string | null, res: { startDate: string; endDate: string }[]) => void,
  ): void;
  Constants: { Permissions: { StepCount: string; SleepAnalysis: string } };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/// iOS HealthKit via react-native-health. Permission is requested once
/// (`initHealthKit`); reads return null on any error so callers degrade to "no
/// data" rather than a fabricated count.
class IosHealthService implements HealthService {
  readonly source = 'device' as const;
  private hk: AppleHealthKit;
  private initialized = false;

  constructor() {
    // `require` (not import) so missing package → throw → provider falls back.
    this.hk = (require('react-native-health') as { default: AppleHealthKit }).default;
  }

  private get permissions() {
    const P = this.hk.Constants.Permissions;
    return { permissions: { read: [P.StepCount, P.SleepAnalysis], write: [] } };
  }

  async requestPermissions(): Promise<boolean> {
    return new Promise((resolve) => {
      this.hk.initHealthKit(this.permissions, (err) => {
        this.initialized = !err;
        resolve(!err);
      });
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
          const minutes = samples.reduce(
            (sum, s) => sum + (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 60000,
            0,
          );
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
    return this.readSum('SleepSession', start, end, (r) => {
      const s = r as { startTime?: string; endTime?: string };
      if (!s.startTime || !s.endTime) return 0;
      return (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 60000;
    });
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
