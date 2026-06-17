import { ExpoNotificationService } from './expoNotifications';
import type { NotificationService } from './notifications';

let _service: NotificationService | null = null;

/**
 * Returns the active notification backend.
 *
 * This is the expo-notifications-backed service; it self-degrades to a no-op
 * where the native module is missing (web / Expo Go limitations), so callers
 * don't branch on platform. Mirrors `getHealthService` / `getFoodParser`.
 */
export function getNotificationService(): NotificationService {
  _service ??= new ExpoNotificationService();
  return _service;
}
