/// Human day titles for the day-history screens: «Сегодня» / «Вчера» /
/// «10 июля, четверг». Hand-rolled from i18n month/weekday keys — the app's
/// convention (no Intl reliance on Hermes), matching the manual formatters
/// elsewhere (mood history, weight rows).

/// Local 'YYYY-MM-DD' of a date.
export function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/// Parses a 'YYYY-MM-DD' key into a local-midnight Date, or null if malformed.
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/// «Сегодня» / «Вчера» / «10 июля, четверг» for a day key. [t] resolves the
/// i18n keys history.today/yesterday/mN/wN.
export function formatDayTitle(
  key: string,
  t: (k: string) => string,
  now: Date = new Date(),
): string {
  const date = parseDayKey(key);
  if (!date) return key;
  const today = localDayKey(now);
  if (key === today) return t('history.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === localDayKey(yesterday)) return t('history.yesterday');
  const month = t(`history.m${date.getMonth() + 1}`);
  const weekday = t(`history.w${date.getDay()}`);
  return `${date.getDate()} ${month}, ${weekday}`;
}

/// A day key shifted by whole days («вчера» = −1). Keys are compared as plain
/// strings everywhere (ISO order = chronological order), so the day panes need
/// exactly this one arithmetic helper and nothing else.
export function shiftDayKey(key: string, days: number): string {
  const d = parseDayKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + days);
  return localDayKey(d);
}

/// Whole days from [key] back to today (0 = today or a future key). The edit
/// screens use it to widen a DayNav's floor so a row OLDER than the default
/// horizon can still be walked back to its own day after a stray «›» tap.
export function daysAgo(key: string, now: Date = new Date()): number {
  const d = parseDayKey(key);
  if (!d) return 0;
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Round, not floor: a DST shift makes the span 23 or 25 hours per day.
  return Math.max(0, Math.round((midnight.getTime() - d.getTime()) / 86_400_000));
}

/// The same clock time moved to another day — how an edit RE-FILES a record:
/// «записал не в тот день» changes the day, not the moment of day, so the
/// row keeps its place in the destination day's order.
export function tsOnDay(original: Date, dayKey: string): Date {
  const d = parseDayKey(dayKey);
  if (!d) return original;
  d.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), 0);
  return d;
}
