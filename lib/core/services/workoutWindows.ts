/// Pure interval math for device-workout session windows — the foundation of
/// the steps↔workout double-count fix. No RN/native imports (jest-friendly),
/// same sweep-merge idea as [asleepMinutes] in sleepSamples.ts.
///
/// Why merging matters: a watch can auto-detect a walk WHILE the user also
/// starts a manual workout — two overlapping sessions. Summing each session's
/// own window steps would subtract the shared stretch twice; the budget must
/// subtract steps inside the merged UNION exactly once.

export interface TimeWindow {
  start: number; // epoch ms, inclusive
  end: number; // epoch ms, exclusive
}

/// Drops empty/invalid windows, sorts by start, merges overlaps and touches.
export function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  const valid = windows
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);
  const merged: TimeWindow[] = [];
  for (const w of valid) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ start: w.start, end: w.end });
    }
  }
  return merged;
}

/// Clips windows to [start, end) — a session crossing midnight contributes only
/// its inside-the-day stretch to that day's subtraction. Windows fully outside
/// vanish.
export function clipWindows(windows: TimeWindow[], start: number, end: number): TimeWindow[] {
  const out: TimeWindow[] = [];
  for (const w of windows) {
    const s = Math.max(w.start, start);
    const e = Math.min(w.end, end);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

/// The day's merged, clipped session windows in one call — what the sync feeds
/// to `stepsInWindow` per interval before summing into steps_days.workout_steps.
export function mergedDayWindows(
  windows: TimeWindow[],
  dayStart: number,
  dayEnd: number,
): TimeWindow[] {
  return mergeWindows(clipWindows(windows, dayStart, dayEnd));
}
