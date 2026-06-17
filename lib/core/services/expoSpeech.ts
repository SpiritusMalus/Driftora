import type { SpeechService } from './speech';

/**
 * `SpeechService` backed by **expo-speech-recognition** — system on-device STT
 * (ru-RU by default): SFSpeechRecognizer on iOS, SpeechRecognizer on Android,
 * wired through the module's Expo config plugin (permissions in app.json).
 *
 * The native module is imported lazily so the app still runs where it's absent
 * (Expo Go / web): the service then reports `isAvailable === false` and every
 * method no-ops, and the food screen falls back to text entry.
 *
 * ⚠️ Speech recognition needs a dev / EAS build — it cannot work in Expo Go,
 * which ships no STT native module.
 */
export class ExpoSpeechService implements SpeechService {
  private _available = false;
  private _mod: typeof import('expo-speech-recognition') | null = null;
  private _subs: { remove(): void }[] = [];

  get isAvailable(): boolean {
    return this._available;
  }

  private async load() {
    if (this._mod) return this._mod;
    try {
      this._mod = await import('expo-speech-recognition');
      return this._mod;
    } catch {
      return null;
    }
  }

  async initialize(): Promise<boolean> {
    const mod = await this.load();
    if (!mod) {
      this._available = false;
      return false;
    }
    try {
      this._available = Boolean(mod.ExpoSpeechRecognitionModule.isRecognitionAvailable());
    } catch {
      this._available = false;
    }
    return this._available;
  }

  async listen(
    onResult: (text: string, isFinal: boolean) => void,
    localeId = 'ru-RU',
  ): Promise<void> {
    const mod = await this.load();
    if (!mod) return;
    const recognizer = mod.ExpoSpeechRecognitionModule;

    // Ask for mic + speech permission on first use; bail quietly if denied so
    // the caller's listening state resets and text entry stays usable.
    try {
      const perm = await recognizer.requestPermissionsAsync();
      if (!perm.granted) return;
    } catch {
      return;
    }

    this.removeSubs();
    this._subs.push(
      recognizer.addListener('result', (e) => {
        const transcript = e.results?.[0]?.transcript;
        if (transcript != null && transcript.length > 0) onResult(transcript, e.isFinal);
      }),
      recognizer.addListener('end', () => this.removeSubs()),
      recognizer.addListener('error', () => this.removeSubs()),
    );

    recognizer.start({ lang: localeId, interimResults: true, continuous: false });
  }

  async stop(): Promise<void> {
    const mod = await this.load();
    if (!mod) return;
    try {
      mod.ExpoSpeechRecognitionModule.stop();
    } catch {
      // already stopped / never started — ignore
    }
  }

  private removeSubs() {
    for (const sub of this._subs) sub.remove();
    this._subs = [];
  }
}
