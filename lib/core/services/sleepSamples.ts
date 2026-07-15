/// Pure helpers for HealthKit sleep samples — NO react-native / native imports,
/// so they run unchanged in jest (the device service that consumes them stays
/// behind a lazy `require`). Kept separate precisely so this logic is testable.

export interface SleepSample {
  startDate: string;
  endDate: string;
  // HealthKit HKCategoryValueSleepAnalysis, surfaced by react-native-health as a
  // string ('INBED' | 'ASLEEP' | 'AWAKE' | 'CORE' | 'DEEP' | 'REM', casing varies
  // by version). Optional — older payloads may omit it.
  value?: string;
}

/// Real time-asleep from HealthKit sleep samples, de-duplicated. HealthKit returns
/// OVERLAPPING samples — the `InBed` envelope plus inner `Asleep`/stage segments,
/// and one set per source (iPhone + Watch + third-party apps). Naively summing
/// every sample's duration double-counts (a 7 h night can read as 13 h+). We:
///   1. keep only samples that represent actual sleep (drop `InBed`/`Awake`), then
///   2. merge overlapping intervals and sum the union, so watch+phone overlap and
///      stage-within-asleep nesting each count once.
/// If no sleep-valued samples exist (older payloads with only `InBed`), we fall
/// back to merging whatever we got rather than reporting nothing. Returns minutes.
export function asleepMinutes(samples: SleepSample[]): number {
  const isAsleep = (v?: string): boolean => {
    const u = (v ?? '').toUpperCase();
    if (u.includes('INBED') || u.includes('AWAKE')) return false;
    return u.includes('ASLEEP') || u === 'CORE' || u === 'DEEP' || u === 'REM';
  };
  const asleep = samples.filter((s) => isAsleep(s.value));
  const chosen = asleep.length > 0 ? asleep : samples;

  const intervals = chosen
    .map((s) => [new Date(s.startDate).getTime(), new Date(s.endDate).getTime()] as const)
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);

  let total = 0;
  let curStart = -1;
  let curEnd = -1;
  for (const [a, b] of intervals) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else if (b > curEnd) {
      curEnd = b;
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total / 60000;
}
