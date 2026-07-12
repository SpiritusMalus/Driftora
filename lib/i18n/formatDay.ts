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
