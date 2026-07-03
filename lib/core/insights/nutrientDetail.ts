import type { NutrientValues } from '../services/foodParser';

/// One row of the expanded "подробный состав" block. `value` is already in the
/// unit given (g for extended-label fields, mg for minerals).
export interface NutrientDetailRow {
  key: 'fiber' | 'sugar' | 'satFat' | 'na' | 'k' | 'ca' | 'mg' | 'fe' | 'zn';
  value: number;
  unit: 'g' | 'mg';
}

const EXTRA_KEYS = ['fiber', 'sugar', 'satFat'] as const;
const MINERAL_KEYS = ['na', 'k', 'ca', 'mg', 'fe', 'zn'] as const;

/// Detail rows for a nutrient block, in display order: extended label first
/// (fiber/sugar/saturated fat — a real 0 IS shown, it's informative), then
/// minerals that are actually present and non-zero (a 0 mg row is noise).
/// Empty result ⇒ the source provided nothing beyond КБЖУ — hide the section.
export function nutrientDetailRows(values: NutrientValues): NutrientDetailRow[] {
  const rows: NutrientDetailRow[] = [];
  for (const key of EXTRA_KEYS) {
    const v = values[key];
    if (typeof v === 'number' && Number.isFinite(v)) rows.push({ key, value: v, unit: 'g' });
  }
  for (const key of MINERAL_KEYS) {
    const v = values.minerals[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) rows.push({ key, value: Math.round(v), unit: 'mg' });
  }
  return rows;
}
