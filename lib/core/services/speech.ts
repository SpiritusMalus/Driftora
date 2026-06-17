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
  listen(
    onResult: (text: string, isFinal: boolean) => void,
    onEnd?: () => void,
    localeId?: string,
  ): Promise<void>;

  /// Stops an active listening session.
  stop(): Promise<void>;
}
