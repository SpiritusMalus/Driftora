/// Gentle local reminders (no server, no push). Implemented in M4 over the
/// `flutter_local_notifications` package.
abstract interface class NotificationService {
  Future<void> initialize();

  /// Requests OS permission to show notifications. Returns whether granted.
  Future<bool> requestPermissions();

  /// Schedules a daily reminder at [hour]:[minute] (local time).
  Future<void> scheduleDaily({
    required int id,
    required int hour,
    required int minute,
    required String title,
    required String body,
  });

  Future<void> cancelAll();
}
