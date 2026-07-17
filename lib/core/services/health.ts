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
}
