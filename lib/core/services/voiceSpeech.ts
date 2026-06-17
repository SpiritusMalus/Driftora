import type { SpeechErrorEvent, SpeechResultsEvent } from '@react-native-voice/voice';

import type { SpeechService } from './speech';

/**
 * `SpeechService` backed by @react-native-voice/voice — on-device speech-to-text
 * (ru-RU by default), no network. The native module is imported lazily so the
 * app still runs where it's absent (web / Expo Go / a build without it): the
 * service then reports `isAvailable === false` and every method is a no-op, and
 * the food screen falls back to text entry.
 */
export class VoiceSpeechService implements SpeechService {
  private _available = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _voice: any = null;

  get isAvailable(): boolean {
    return this._available;
  }

  private async load() {
    if (this._voice) return this._voice;
    try {
      const mod = await import('@react-native-voice/voice');
      this._voice = mod.default;
      return this._voice;
    } catch {
      return null;
    }
  }

  async initialize(): Promise<boolean> {
    const voice = await this.load();
    if (!voice) {
      this._available = false;
      return false;
    }
    try {
      this._available = Boolean(await voice.isAvailable());
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async listen(
    onResult: (text: string, isFinal: boolean) => void,
    localeId = 'ru-RU',
  ): Promise<void> {
    const voice = await this.load();
    if (!voice) return;
    voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      const value = e.value?.[0];
      if (value != null) onResult(value, false);
    };
    voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const value = e.value?.[0];
      if (value != null) onResult(value, true);
    };
    voice.onSpeechError = (_e: SpeechErrorEvent) => {
      // Surfaced via the screen's listening state resetting on stop; swallow here.
    };
    await voice.start(localeId);
  }

  async stop(): Promise<void> {
    const voice = await this.load();
    if (!voice) return;
    try {
      await voice.stop();
    } catch {
      // already stopped / never started — ignore
    }
  }
}
