/// Gentle local reminders (no server, no push). Implemented in M4 over
/// expo-notifications.
export interface NotificationService {
  initialize(): Promise<void>;

  /// Requests OS permission to show notifications. Returns whether granted.
  requestPermissions(): Promise<boolean>;

  /// Schedules a daily reminder at hour:minute (local time).
  scheduleDaily(opts: {
    id: string;
    hour: number;
    minute: number;
    title: string;
    body: string;
  }): Promise<void>;

  cancelAll(): Promise<void>;
}
