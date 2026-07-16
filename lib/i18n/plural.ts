/// Plural-correct key pick without the i18next plural plugin (this app pins
/// `lng: 'ru'` and branches by hand — extracted from the mood screen's
/// marksKey/buildingKey idiom so every «N of a thing» line shares one rule).
/// The ru locale carries One/Few/Many under a stem; en reuses One + Many
/// (its "other") — the same slugs resolve in both.
export function pluralKey(stem: string, n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${stem}One`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${stem}Few`;
  return `${stem}Many`;
}
