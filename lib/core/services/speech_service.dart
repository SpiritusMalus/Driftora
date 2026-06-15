/// On-device speech-to-text (ru-RU) for voice food logging.
///
/// Implemented in M1 over the `speech_to_text` package; the food flow degrades
/// to text input when speech is unavailable.
abstract interface class SpeechService {
  /// Initializes the engine. Returns false if speech is unavailable.
  Future<bool> initialize();

  /// Whether a recognizer for the requested locale is available.
  bool get isAvailable;

  /// Starts listening; [onResult] fires with partial and final transcripts.
  Future<void> listen({
    required void Function(String text, bool isFinal) onResult,
    String localeId = 'ru_RU',
  });

  /// Stops an active listening session.
  Future<void> stop();
}
