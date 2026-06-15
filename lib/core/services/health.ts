/// Reads activity from the OS health store (HealthKit / Health Connect).
/// Implemented in M2 over react-native-health + react-native-health-connect.
export interface HealthService {
  /// Requests read permission for steps. Returns whether it was granted.
  requestPermissions(): Promise<boolean>;

  /// Total steps for the given local day, or null if unavailable.
  stepsForDay(day: Date): Promise<number | null>;
}
