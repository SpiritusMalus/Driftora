import type { AudioInput } from './foodParser';

/// Voice-note recording for AI food logging (Telegram-style: record → send).
///
/// Backed by `expo-av`'s imperative `Audio.Recording`. The module is loaded
/// LAZILY via `require` (not a static import) so tsc / jest / Expo Go never touch
/// the native dependency: if it's absent, every function degrades to "not
/// available" / null and the screen falls back to text or system STT. The native
/// side links on a dev / EAS build; mic permission is already declared in app.json.
///
/// ⚠️ Needs a dev build to actually record — verify the produced container on
/// device (expo-av HIGH_QUALITY is m4a/AAC, which OpenRouter accepts).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _audio: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function audioModule(): any {
  if (_audio) return _audio;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _audio = require('expo-av').Audio;
  return _audio;
}

/// A live recording session — call `stop()` once to finish and get the clip.
export interface ActiveRecording {
  stop(): Promise<AudioInput | null>;
  cancel(): Promise<void>;
}

/// Whether voice-note recording is even possible in this build (native module
/// present). False in Expo Go / web → the caller hides the record button.
export function isAudioRecordingAvailable(): boolean {
  try {
    audioModule();
    return true;
  } catch {
    return false;
  }
}

/// Request mic permission. Returns false (never throws) when denied/unavailable.
export async function requestAudioPermission(): Promise<boolean> {
  try {
    const { granted } = await audioModule().requestPermissionsAsync();
    return !!granted;
  } catch {
    return false;
  }
}

/// Start recording. Returns null if permission is denied or the module is
/// missing, so the caller can fall back without a crash.
export async function startRecording(): Promise<ActiveRecording | null> {
  try {
    const Audio = audioModule();
    if (!(await requestAudioPermission())) return null;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();

    let done = false;
    const teardown = async () => {
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {
        /* best-effort */
      }
    };
    return {
      async stop(): Promise<AudioInput | null> {
        if (done) return null;
        done = true;
        try {
          await recording.stopAndUnloadAsync();
          const uri = recording.getURI();
          await teardown();
          return uri ? { uri, mimeType: 'audio/m4a' } : null;
        } catch {
          await teardown();
          return null;
        }
      },
      async cancel(): Promise<void> {
        if (done) return;
        done = true;
        try {
          await recording.stopAndUnloadAsync();
        } catch {
          /* ignore */
        }
        await teardown();
      },
    };
  } catch {
    return null;
  }
}
