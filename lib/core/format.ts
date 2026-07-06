/// Number formatting for the ru-first UI. Russian uses a comma decimal separator
/// and space-grouped thousands, but bare `.toFixed()` always emits a dot and no
/// grouping — which reads as an English/technical slip on a weight or BMI value.
/// These helpers centralize display formatting. DISPLAY ONLY: never feed the
/// output back into parsing or arithmetic.

/// A decimal with `digits` fraction places and a comma separator: 72.5 → "72,5".
export function formatDecimal(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits).replace('.', ',');
}

/// An integer grouped for ru ("1 234"). Uses `toLocaleString('ru-RU')` to match
/// the grouping the Steps screen already uses, so the same count reads the same
/// way everywhere.
export function formatInt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}
