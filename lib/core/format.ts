import { currentLocale } from '@/lib/i18n';

/// Number formatting for the ru-first UI. Russian uses a comma decimal separator
/// and space-grouped thousands, but bare `.toFixed()` always emits a dot and no
/// grouping — which reads as an English/technical slip on a weight or BMI value.
/// These helpers centralize display formatting. DISPLAY ONLY: never feed the
/// output back into parsing or arithmetic.

/// Fixed decimal places, with the app language’s decimal separator.
export function formatDecimal(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return currentLocale() === 'en' ? n.toFixed(digits) : n.toFixed(digits).replace('.', ',');
}

/// Integer grouping follows the explicit app language: 1 234 / 1,234.
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString(currentLocale() === 'en' ? 'en-US' : 'ru-RU');
}

/// Dates follow the app language, rather than the device’s language.
export function formatDate(date: Date): string {
  return date.toLocaleDateString(currentLocale() === 'en' ? 'en-US' : 'ru-RU');
}
