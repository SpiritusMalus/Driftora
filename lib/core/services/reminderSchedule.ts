/**
 * Pure scheduling math for the local reminders (Roadmap backlog #2). Computes
 * when each saved "HH:mm" reminder next fires — the device `NotificationService`
 * (expo-notifications, not yet installed) will consume this; until then the
 * settings screen uses it to show the next upcoming reminder.
 *
 * Pure + testable offline; only the actual OS delivery is device-gated.
 */

export interface TimeOfDay {
  hour: number;
  minute: number;
}

/// Parses a strict "HH:mm" (00:00–23:59) into a `TimeOfDay`, or null if invalid.
export function parseTimeOfDay(hhmm: string): TimeOfDay | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/// The next local DateTime at [time] strictly after [now] — today if it's still
/// ahead, otherwise tomorrow.
export function nextOccurrence(time: TimeOfDay, now: Date): Date {
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    time.hour,
    time.minute,
    0,
    0,
  );
  if (today.getTime() > now.getTime()) return today;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}

/// Next fire DateTimes for each valid reminder string, soonest-first. Invalid
/// strings are skipped defensively.
export function nextFireTimes(times: string[], now: Date = new Date()): Date[] {
  return times
    .map(parseTimeOfDay)
    .filter((t): t is TimeOfDay => t !== null)
    .map((t) => nextOccurrence(t, now))
    .sort((a, b) => a.getTime() - b.getTime());
}

/// The soonest upcoming reminder, or null if there are none.
export function nextReminder(times: string[], now: Date = new Date()): Date | null {
  const all = nextFireTimes(times, now);
  return all.length > 0 ? all[0] : null;
}
