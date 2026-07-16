/// Gentle local reminders (no server, no push). Implemented in M4 over
/// expo-notifications.
export interface NotificationService {
  initialize(): Promise<void>;

  /// Requests OS permission to show notifications. Returns whether granted.
  requestPermissions(): Promise<boolean>;

  /// Schedules a daily reminder at hour:minute (local time). With `once`, fires
  /// a single time at the next hour:minute TODAY instead of repeating — and is
  /// skipped entirely when that moment already passed (the context is stale).
  scheduleDaily(opts: {
    id: string;
    hour: number;
    minute: number;
    title: string;
    body: string;
    once?: boolean;
  }): Promise<void>;

  cancelAll(): Promise<void>;
}
