/// Pure, dependency-free buffer math for the recording waveform, kept out of the
/// `.tsx` so it can be unit-tested in the node jest env without loading react-native.

/// Append a new amplitude level (0..1) to a rolling buffer, keeping at most
/// `max` of the most recent samples (newest last). Levels are clamped to 0..1
/// and non-finite values coerce to 0. Never mutates the input.
export function pushLevel(buffer: readonly number[], level: number, max: number): number[] {
  const safe = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const next = [...buffer, safe];
  return next.length > max ? next.slice(next.length - max) : next;
}
