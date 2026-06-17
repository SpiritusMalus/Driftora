/// On-device speech-to-text (ru-RU) for voice food logging. Backed by
/// expo-speech-recognition; degrades to text input when unavailable (Expo Go).
export interface SpeechService {
  /// Initializes the engine. Returns false if speech is unavailable.
  initialize(): Promise<boolean>;

  /// Whether a recognizer for the requested locale is available.
  readonly isAvailable: boolean;

  /// Starts listening; `onResult` fires with partial and final transcripts.
  listen(
    onResult: (text: string, isFinal: boolean) => void,
    localeId?: string,
  ): Promise<void>;

  /// Stops an active listening session.
  stop(): Promise<void>;
}
