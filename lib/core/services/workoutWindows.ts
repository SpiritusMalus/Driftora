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

/// What's left of [window] after removing everything covered by [claimed] — the
/// same overlap problem as above, applied to ENERGY instead of steps.
///
/// The steps side has always merged before subtracting; the kcal side asked the
/// OS for each session's own window separately, so two overlapping sessions both
/// billed the shared stretch and the day's total counted it twice. Giving each
/// session only its EXCLUSIVE stretch makes the rows sum to the union exactly
/// once, and keeps every row a number that still means something on its own.
/// [claimed] does not need to be pre-merged; the result is sorted and disjoint.
export function subtractWindows(window: TimeWindow, claimed: TimeWindow[]): TimeWindow[] {
  if (!(Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start)) {
    return [];
  }
  let cursor = window.start;
  const out: TimeWindow[] = [];
  for (const c of mergeWindows(claimed)) {
    if (c.end <= cursor) continue; // entirely behind us
    if (c.start >= window.end) break; // merged input is sorted — the rest is past
    if (c.start > cursor) out.push({ start: cursor, end: Math.min(c.start, window.end) });
    cursor = Math.max(cursor, c.end);
    if (cursor >= window.end) return out;
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}
