import { File } from 'expo-file-system';

/// Best-effort deletion of a transient cache file — the downscaled JPEG from
/// `photoProvider.prepare()` or the recorded m4a from `audioRecorder` — once it
/// has been uploaded to the food parser. Without this, the cache accumulates one
/// file per photo/voice log forever (the OS cache sweep is neither prompt nor
/// guaranteed). Never throws: the URI may already be gone or be a non-file
/// scheme, and a cleanup failure must not disrupt the log flow. Runs on every
/// path (success, parse failure, offline stub) — call it from a `finally`.
export function deleteTempFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    /* best-effort — already gone, or not a deletable file URI */
  }
}
