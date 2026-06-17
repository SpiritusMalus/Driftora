import type { NotificationService } from './notifications';

/**
 * `NotificationService` backed by expo-notifications — local, on-device only
 * (no server, no push token). The native module is imported lazily so the app
 * still runs where it's absent (web, or a build without it): every method then
 * degrades to a no-op and `requestPermissions` reports false. Real delivery
 * needs a native build + the OS notification permission.
 */
export class ExpoNotificationService implements NotificationService {
  private async mod() {
    try {
      return await import('expo-notifications');
    } catch {
      return null;
    }
  }

  async initialize(): Promise<void> {
    const N = await this.mod();
    if (!N) return;
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  }

  async requestPermissions(): Promise<boolean> {
    const N = await this.mod();
    if (!N) return false;
    const current = await N.getPermissionsAsync();
    if (current.granted) return true;
    const requested = await N.requestPermissionsAsync();
    return requested.granted;
  }

  async scheduleDaily(opts: {
    id: string;
    hour: number;
    minute: number;
    title: string;
    body: string;
  }): Promise<void> {
    const N = await this.mod();
    if (!N) return;
    await N.scheduleNotificationAsync({
      identifier: opts.id,
      content: { title: opts.title, body: opts.body },
      trigger: {
        type: N.SchedulableTriggerInputTypes.DAILY,
        hour: opts.hour,
        minute: opts.minute,
      },
    });
  }

  async cancelAll(): Promise<void> {
    const N = await this.mod();
    if (!N) return;
    await N.cancelAllScheduledNotificationsAsync();
  }
}
