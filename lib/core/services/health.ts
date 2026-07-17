/// Whether the OS health store can be used at all — checked BEFORE requesting
/// permission so a missing/outdated provider gets honest guidance instead of a
/// silent no-op. 'available' = ready to request; 'update_required' = provider
/// present but needs a Play Store update; 'unavailable' = not usable on this
/// device/OS; 'unsupported' = no native health module in this build.
export type HealthAvailability = 'available' | 'update_required' | 'unavailable' | 'unsupported';

/// One timestamped scalar sample from the OS health store (weigh-in, body-fat
/// measurement, …). `at` is ISO-8601; the unit is fixed by the reading method.
export interface HealthSample {
  at: string;
  value: number;
}

/// One device-recorded workout session, already normalized to the app's
/// vocabulary (see exerciseTypeMap.ts). `deviceKcal` is the session's OWN
/// energy total when the store carried one (HealthKit does; Health Connect
/// sessions don't — their energy comes from an ActiveCaloriesBurned window
/// aggregate at sync time). `type` is imported as a string to avoid coupling
/// this seam to the insights layer; values are WorkoutType keys or 'other'.
export interface DeviceWorkoutSession {
  externalId: string;
  start: string; // ISO-8601
  end: string; // ISO-8601
  type: string;
  title: string | null;
  deviceKcal: number | null;
  origin: string | null; // writing app (sourceName / dataOrigin package)
}

/// Reads activity from the OS health store (HealthKit / Health Connect).
/// Implemented in M2 over react-native-health + react-native-health-connect.
export interface HealthService {
  /// Provenance of the counts this service reports, used to tag stored steps.
  /// 'device' = real OS health store; 'stub' = offline deterministic fill
  /// (dev/Expo Go only). Optional — absent is treated as 'device'.
  readonly source?: 'device' | 'stub';

  /// Whether the health store is usable right now (see [HealthAvailability]).
  /// Optional — absent means assume 'available' (stub/iOS just proceed to the
  /// permission request). Lets the UI distinguish "needs install/update" from a
  /// real denial instead of failing blind.
  availability?(): Promise<HealthAvailability>;

  /// Requests read permission for steps (and sleep). Returns whether granted.
  requestPermissions(): Promise<boolean>;

  /// Total steps for the given local day, or null if unavailable.
  stepsForDay(day: Date): Promise<number | null>;

  /// Total sleep in MINUTES for the night ending on the given local day, or
  /// null if unavailable. Same passive-signal seam as steps — a deterministic
  /// offline stub fills it until a device dev build wires real sleep data.
  sleepForDay(day: Date): Promise<number | null>;

  /// Requests the EXTENDED read grants beyond steps+sleep (weight, body fat,
  /// workouts, vitals). Called ONLY from an explicit user tap on a connect
  /// card — never lazily from a read — so existing users are never surprised
  /// by an OS permission sheet. Optional: absent means "can't" (returns false
  /// in Null; the UI hides the card then).
  requestExtendedPermissions?(): Promise<boolean>;

  /// Scale weigh-ins in KILOGRAMS inside [start, end], oldest first, or null
  /// when unreadable (no grant / no data / no module). Range-based so a 30-day
  /// backfill is one native call.
  weightSamplesForRange?(start: Date, end: Date): Promise<HealthSample[] | null>;

  /// Scale body-fat measurements in PERCENT (0–100) inside [start, end], or
  /// null. Implementations normalize platform quirks (HealthKit returns the
  /// raw 0–1 fraction) before returning.
  bodyFatSamplesForRange?(start: Date, end: Date): Promise<HealthSample[] | null>;

  /// Device workout sessions OVERLAPPING the given local day (a session that
  /// started the previous evening and crossed midnight is included). Sessions
  /// without a store record id are dropped by implementations — no synthesized
  /// dedup keys. Null when unreadable.
  workoutSessionsForDay?(day: Date): Promise<DeviceWorkoutSession[] | null>;

  /// OS-deduplicated step count inside an arbitrary window. Implementations
  /// MUST use statistics/aggregate APIs (HealthKit statistics collection,
  /// Health Connect aggregate) — raw samples double-count watch+phone.
  stepsInWindow?(start: Date, end: Date): Promise<number | null>;

  /// OS-deduplicated active energy (kcal) inside a window — the measured burn
  /// of a session, preferred over any MET estimate.
  activeKcalInWindow?(start: Date, end: Date): Promise<number | null>;

  /// Informational body/night signals for the day: resting HR (that calendar
  /// day), HRV / SpO₂ / respiratory rate averaged over the night ending on the
  /// day (same noon-to-noon window as sleep), VO₂max (latest within 60 days).
  /// Every metric independently nullable. DISPLAY ONLY — never calorie math.
  bodySignalsForDay?(day: Date): Promise<DeviceBodySignals | null>;
}

/// See [HealthService.bodySignalsForDay]. `hrvMethod` names the metric: iOS
/// measures SDNN, Android RMSSD — different quantities, never merge silently.
export interface DeviceBodySignals {
  restingBpm: number | null;
  hrvMs: number | null;
  hrvMethod: 'sdnn' | 'rmssd' | null;
  spo2Pct: number | null; // 0–100
  respRate: number | null; // breaths/min
  vo2Max: number | null; // ml/kg/min
}
