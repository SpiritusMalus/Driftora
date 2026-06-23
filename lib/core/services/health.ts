/// Reads activity from the OS health store (HealthKit / Health Connect).
/// Implemented in M2 over react-native-health + react-native-health-connect.
export interface HealthService {
  /// Requests read permission for steps (and sleep). Returns whether granted.
  requestPermissions(): Promise<boolean>;

  /// Total steps for the given local day, or null if unavailable.
  stepsForDay(day: Date): Promise<number | null>;

  /// Total sleep in MINUTES for the night ending on the given local day, or
  /// null if unavailable. Same passive-signal seam as steps — a deterministic
  /// offline stub fills it until a device dev build wires real sleep data.
  sleepForDay(day: Date): Promise<number | null>;
}
