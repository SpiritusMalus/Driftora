import { speechLocale } from '@/lib/i18n';

import type { SpeechEndReason, SpeechErrorCode, SpeechService } from './speech';

// Non-continuous dictation must release its UI and microphone even when a
// native permission request or recognizer fails to deliver a terminal event.
const SESSION_TIMEOUT_MS = 60_000;

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
  private _session: { finish(reason?: SpeechEndReason, abortNative?: boolean): void } | null = null;

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
    localeId = speechLocale(),
  ): Promise<void> {
    this._session?.finish({ code: 'aborted' }, true);

    // Subscriptions and completion belong to this attempt. A stale callback
    // must never remove the listeners of a newer listening session.
    let ended = false;
    let started = false;
    const subs: { remove(): void }[] = [];
    let release!: (value: null) => void;
    const cancelled = new Promise<null>((resolve) => { release = resolve; });
    let timer: ReturnType<typeof setTimeout>;
    const session = {
      finish: (reason?: SpeechEndReason, abortNative = false) => finish(reason, abortNative),
    };
    const finish = (reason?: SpeechEndReason, abortNative = false) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      for (const sub of subs) {
        try { sub.remove(); } catch { /* native teardown is best-effort */ }
      }
      subs.length = 0;
      if (this._session === session) this._session = null;
      // Detach listeners BEFORE abort: the library emits aborted/end events.
      // stop() requests another final result; cancellation must not wait for it.
      if (abortNative && started) {
        started = false;
        try { this._mod?.ExpoSpeechRecognitionModule.abort(); } catch { /* already ended */ }
      }
      release(null);
      if (reason) {
        // The ONLY place the failure cause is recorded. Code + a generic engine
        // message (never the spoken text — privacy §2). Dev-only to avoid noise.
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn(`[speech] recognition failed: ${reason.code}${reason.message ? ` — ${reason.message}` : ''}`);
        }
      }
      onEnd?.(reason);
    };
    this._session = session;
    timer = setTimeout(() => finish({ code: 'speech-timeout' }, true), SESSION_TIMEOUT_MS);

    // Racing cancellation also settles listen() when the OS permission promise
    // never returns. A later resolution is ignored and cannot open the mic.
    const mod = await Promise.race([this.load(), cancelled]);
    if (ended) return;
    if (!mod) return finish({ code: 'unknown', message: 'speech module unavailable' });
    const recognizer = mod.ExpoSpeechRecognitionModule;

    // Ask for mic + speech permission on first use; surface a denial as a real
    // reason so the caller can prompt for access (text entry stays usable too).
    try {
      const perm = await Promise.race([recognizer.requestPermissionsAsync(), cancelled]);
      if (ended) return;
      if (!perm?.granted) return finish({ code: 'not-allowed', message: 'microphone permission denied' });
    } catch {
      return finish({ code: 'not-allowed', message: 'permission request failed' });
    }

    try {
      subs.push(recognizer.addListener('result', (e) => {
        if (ended) return;
        const transcript = e.results?.[0]?.transcript;
        try {
          if (transcript != null && transcript.length > 0) onResult(transcript, e.isFinal);
        } finally {
          // continuous:false final results are terminal, even without native end.
          if (e.isFinal) finish(undefined, true);
        }
      }));
      subs.push(recognizer.addListener('end', () => finish()));
      subs.push(recognizer.addListener('error', (e) =>
        finish({ code: mapSpeechError((e as { error?: string }).error), message: (e as { message?: string }).message }, true),
      ));
      started = true;
      recognizer.start({ lang: localeId, interimResults: true, continuous: false });
    } catch {
      finish({ code: 'unknown', message: 'speech recognition start failed' }, true);
    }
  }

  async stop(): Promise<void> {
    // Synchronous invalidation matters while permission/loading is pending.
    // A clean user stop has no error reason and never relies on a native event.
    this._session?.finish(undefined, true);
  }
}
