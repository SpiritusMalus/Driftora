import type { AudioInput } from './foodParser';
import { deleteTempFile } from './tempFiles';

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
  /// Subscribe to live amplitude samples (normalized 0..1) for a waveform.
  /// No-op (returns a no-op unsubscribe) when metering isn't available, so the
  /// caller never has to guard — recording still works, there are just no bars.
  onMeter(cb: (level: number) => void): () => void;
  /// Loudest normalized level observed over the whole session, or null when
  /// this build delivered no metering at all. Lets the caller tell a clip of
  /// pure silence (muted/held mic) from one the model simply couldn't parse.
  peakLevel(): number | null;
}

/// Why recording didn't start: 'denied' = mic permission refused; 'failed' =
/// permission is GRANTED but the recorder wouldn't start (mic held by another
/// app, post-permission-dialog race). The UI must not blame permissions for
/// the latter — «разрешил доступ, а звук не ловился» (device feedback).
export type StartRecordingError = 'denied' | 'failed';

export type StartRecordingResult =
  | { recording: ActiveRecording; error?: undefined }
  | { recording?: undefined; error: StartRecordingError };

/// Map expo-av's dB metering (negative, ~-160..0) onto a 0..1 amplitude. Floor
/// at -60 dB so ambient quiet maps to ~0 and a normal voice fills the bar. Pure
/// + exported so the normalization is unit-testable without the native module.
export function normalizeMeterDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const FLOOR = -60;
  if (db <= FLOOR) return 0;
  if (db >= 0) return 1;
  return (db - FLOOR) / -FLOOR;
}

/// A whole-clip peak below this means the mic delivered no real signal — a
/// system privacy mute or a mic held by another app. A working mic in a quiet
/// room still floats well above (-50 dB ≈ 0.17); true digital silence pins to
/// 0 (≤ -60 dB). A null peak (no metering on this build) never counts.
const SILENT_PEAK = 0.02;

/// True when a finished clip is effectively silence (see [SILENT_PEAK]).
export function isSilentRecording(peak: number | null): boolean {
  return peak != null && peak < SILENT_PEAK;
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

/// Start recording. Distinguishes a permission denial from a start failure
/// (see [StartRecordingError]) and retries a failed start once: the permission
/// dialog pauses the app, and starting the recorder in the same breath is a
/// known transient failure — one short-delay retry turns "broken on the very
/// first use" into "works".
export async function startRecording(): Promise<StartRecordingResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Audio: any;
  try {
    Audio = audioModule();
  } catch {
    return { error: 'failed' };
  }
  if (!(await requestAudioPermission())) return { error: 'denied' };
  try {
    return { recording: await begin(Audio) };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      return { recording: await begin(Audio) };
    } catch {
      return { error: 'failed' };
    }
  }
}

/// One prepare→start attempt. Throws on failure — AFTER unloading the
/// half-built recorder: the platform allows a single prepared recorder at a
/// time, so a leaked one would doom the retry and every later attempt.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function begin(Audio: any): Promise<ActiveRecording> {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const recording = new Audio.Recording();
  // Clone HIGH_QUALITY with metering on so status updates carry `metering` (dB),
  // which feeds the live waveform. Falls back to the bare preset if cloning
  // throws for any reason — recording must never depend on metering.
  let options = Audio.RecordingOptionsPresets.HIGH_QUALITY;
  try {
    options = { ...options, isMeteringEnabled: true };
  } catch {
    /* keep the preset */
  }
  try {
    await recording.prepareToRecordAsync(options);
  } catch (e) {
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
    // The audio mode was already flipped to record — reset it, or a failed
    // start leaves the iOS session in recording mode for the rest of the app.
    await resetAudioMode(Audio);
    throw e;
  }

  // Fan out metering samples to subscribers. We poll status at a steady cadence
  // and read `metering` (dB) when present; subscribers get a normalized 0..1.
  // The session-wide peak is tracked here too — the silence check must not
  // depend on anyone having subscribed to the waveform.
  const meterCbs = new Set<(level: number) => void>();
  let peak: number | null = null;
  try {
    recording.setProgressUpdateInterval(80);
    recording.setOnRecordingStatusUpdate((status: { metering?: number }) => {
      if (status == null || typeof status.metering !== 'number') return;
      const level = normalizeMeterDb(status.metering);
      if (peak == null || level > peak) peak = level;
      for (const cb of meterCbs) cb(level);
    });
  } catch {
    /* no metering on this build — onMeter stays a no-op, peak stays null */
  }
  try {
    await recording.startAsync();
  } catch (e) {
    try {
      await recording.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
    await resetAudioMode(Audio);
    throw e;
  }

  let done = false;
  const teardown = async () => resetAudioMode(Audio);
  return {
    async stop(): Promise<AudioInput | null> {
      if (done) return null;
      done = true;
      meterCbs.clear();
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        await teardown();
        return uri ? { uri, mimeType: 'audio/m4a' } : null;
      } catch {
        await teardown();
        // A clip nobody will consume must not sit in cache.
        deleteRecordingFile(recording);
        return null;
      }
    },
    async cancel(): Promise<void> {
      if (done) return;
      done = true;
      meterCbs.clear();
      try {
        await recording.stopAndUnloadAsync();
      } catch {
        /* ignore */
      }
      await teardown();
      // Cancel means the clip is unwanted — every abandoned recording (screen
      // unmount, user abort) otherwise leaves its m4a in cache forever.
      deleteRecordingFile(recording);
    },
    onMeter(cb: (level: number) => void): () => void {
      if (done) return () => {};
      meterCbs.add(cb);
      return () => meterCbs.delete(cb);
    },
    peakLevel(): number | null {
      return peak;
    },
  };
}

/// Return the OS audio session to playback mode — must run on EVERY exit path
/// (stop, cancel, prepare/start failure), or iOS stays in record mode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resetAudioMode(Audio: any): Promise<void> {
  try {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  } catch {
    /* best-effort */
  }
}

/// Best-effort removal of the recorded clip when nobody will consume it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deleteRecordingFile(recording: any): void {
  try {
    deleteTempFile(recording.getURI());
  } catch {
    /* the recorder may refuse getURI() mid-teardown — nothing to clean then */
  }
}
