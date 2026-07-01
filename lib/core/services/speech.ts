/// Why a listening session ended badly. Mapped from the recognizer's own error
/// codes to a small, stable set the UI can localize (food.voiceError.*). A clean
/// end (final result or a user-initiated stop) carries NO reason — `onEnd()` is
/// called with `undefined`, so a reason always means "something went wrong".
export type SpeechErrorCode =
  | 'no-speech' // recognizer heard no speech
  | 'speech-timeout' // silence / it timed out waiting
  | 'network' // online recognition needed and the network failed
  | 'not-allowed' // mic / speech permission denied
  | 'language-not-supported' // no ru-RU recognizer/voice pack on the device
  | 'audio-capture' // microphone capture failed
  | 'busy' // recognizer already in use
  | 'aborted' // cancelled before any result
  | 'unknown'; // anything else (incl. a missing native module)

export interface SpeechEndReason {
  code: SpeechErrorCode;
  /// The engine's raw message (a generic technical string — never the user's
  /// speech), kept for dev logs. Not shown to the user.
  message?: string;
}

/// On-device speech-to-text (ru-RU) for voice food logging. Backed by
/// expo-speech-recognition; degrades to text input when unavailable (Expo Go).
export interface SpeechService {
  /// Initializes the engine. Returns false if speech is unavailable.
  initialize(): Promise<boolean>;

  /// Whether a recognizer for the requested locale is available.
  readonly isAvailable: boolean;

  /// Starts listening; `onResult` fires with partial and final transcripts.
  /// `onEnd` fires exactly once when the session ends for ANY reason — a final
  /// result, no match, an error, a timeout, or permission denial — so callers
  /// can always reset their "listening" UI (a final result is not guaranteed).
  /// On a failure it receives a [SpeechEndReason]; a clean end passes nothing,
  /// so the caller can both reset the UI AND explain what went wrong.
  listen(
    onResult: (text: string, isFinal: boolean) => void,
    onEnd?: (reason?: SpeechEndReason) => void,
    localeId?: string,
  ): Promise<void>;

  /// Stops an active listening session.
  stop(): Promise<void>;
}
