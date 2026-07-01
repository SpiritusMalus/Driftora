import type { SpeechEndReason, SpeechErrorCode, SpeechService } from './speech';

/// Map the recognizer's raw error code (Web Speech / native) to our small,
/// stable [SpeechErrorCode]. Unknown/empty codes fold to 'unknown'. Pure — the
/// caller localizes the result and decides what to show.
export function mapSpeechError(raw: string | undefined): SpeechErrorCode {
  switch (raw) {
    case 'no-speech':
      return 'no-speech';
    case 'speech-timeout':
      return 'speech-timeout';
    case 'network':
      return 'network';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'not-allowed';
    case 'language-not-supported':
    case 'bad-grammar':
      return 'language-not-supported';
    case 'audio-capture':
      return 'audio-capture';
    case 'busy':
    case 'recognizer-busy':
      return 'busy';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

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
    onEnd?: (reason?: SpeechEndReason) => void,
    localeId = 'ru-RU',
  ): Promise<void> {
    // `onEnd` must fire exactly once, on the first terminal path we hit
    // (denied/missing module/end/error), so the caller's "listening" UI always
    // resets even when no final result arrives. A failure passes a reason so the
    // caller can explain it; a clean end ('end' event, user stop) passes none.
    let ended = false;
    const finish = (reason?: SpeechEndReason) => {
      if (ended) return;
      ended = true;
      this.removeSubs();
      if (reason) {
        // The ONLY place the failure cause is recorded. Code + a generic engine
        // message (never the spoken text — privacy §2). Dev-only to avoid noise.
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(`[speech] recognition failed: ${reason.code}${reason.message ? ` — ${reason.message}` : ''}`);
        }
      }
      onEnd?.(reason);
    };

    const mod = await this.load();
    if (!mod) return finish({ code: 'unknown', message: 'speech module unavailable' });
    const recognizer = mod.ExpoSpeechRecognitionModule;

    // Ask for mic + speech permission on first use; surface a denial as a real
    // reason so the caller can prompt for access (text entry stays usable too).
    try {
      const perm = await recognizer.requestPermissionsAsync();
      if (!perm.granted) return finish({ code: 'not-allowed', message: 'microphone permission denied' });
    } catch {
      return finish({ code: 'not-allowed', message: 'permission request failed' });
    }

    this.removeSubs();
    this._subs.push(
      recognizer.addListener('result', (e) => {
        const transcript = e.results?.[0]?.transcript;
        if (transcript != null && transcript.length > 0) onResult(transcript, e.isFinal);
      }),
      recognizer.addListener('end', () => finish()),
      recognizer.addListener('error', (e) =>
        finish({ code: mapSpeechError((e as { error?: string }).error), message: (e as { message?: string }).message }),
      ),
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
