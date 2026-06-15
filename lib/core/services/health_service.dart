/// Reads activity data from the OS health store (HealthKit / Health Connect).
///
/// Implemented in M2 over the `health` package. Kept behind an interface so the
/// activity feature can be unit-tested with a fake.
abstract interface class HealthService {
  /// Requests read permission for steps. Returns whether it was granted.
  Future<bool> requestPermissions();

  /// Total steps for the given local [day], or null if unavailable.
  Future<int?> stepsForDay(DateTime day);
}
