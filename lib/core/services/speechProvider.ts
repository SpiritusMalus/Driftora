import { ExpoSpeechService } from './expoSpeech';
import type { SpeechService } from './speech';

let _service: SpeechService | null = null;

/**
 * Returns the active speech-to-text backend.
 *
 * This is the expo-speech-recognition-backed service; it self-reports
 * `isAvailable === false` and no-ops where the native module is missing (web /
 * Expo Go), so callers gate the mic UI on `isAvailable` rather than on platform.
 * Mirrors `getNotificationService` / `getHealthService` / `getFoodParser`.
 */
export function getSpeechService(): SpeechService {
  _service ??= new ExpoSpeechService();
  return _service;
}
