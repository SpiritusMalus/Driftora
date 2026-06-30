/// Whether the OS health store can be used at all — checked BEFORE requesting
/// permission so a missing/outdated provider gets honest guidance instead of a
/// silent no-op. 'available' = ready to request; 'update_required' = provider
/// present but needs a Play Store update; 'unavailable' = not usable on this
/// device/OS; 'unsupported' = no native health module in this build.
export type HealthAvailability = 'available' | 'update_required' | 'unavailable' | 'unsupported';

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
}
