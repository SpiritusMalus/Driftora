import type { NutrientValues, Vitamins } from '../services/foodParser';

/// One row of the expanded "подробный состав" block. `value` is already in the
/// unit given (g for extended-label fields, mg/mcg for minerals & vitamins).
export interface NutrientDetailRow {
  key:
    | 'fiber'
    | 'sugar'
    | 'satFat'
    | 'na'
    | 'k'
    | 'ca'
    | 'mg'
    | 'fe'
    | 'zn'
    | 'vitA'
    | 'vitD'
    | 'vitE'
    | 'vitC'
    | 'vitB1'
    | 'vitB2'
    | 'vitB6'
    | 'vitB9'
    | 'vitB12';
  value: number;
  unit: 'g' | 'mg' | 'mcg';
}

const EXTRA_KEYS = ['fiber', 'sugar', 'satFat'] as const;
const MINERAL_KEYS = ['na', 'k', 'ca', 'mg', 'fe', 'zn'] as const;

/// Vitamin display order + units, as USDA reports them (µg for A/D/B9/B12,
/// mg for E/C/B1/B2/B6). `row` is the i18n/React key, `key` the storage field.
const VITAMIN_ROWS: readonly { row: NutrientDetailRow['key']; key: keyof Vitamins; unit: 'mg' | 'mcg' }[] = [
  { row: 'vitA', key: 'a', unit: 'mcg' },
  { row: 'vitD', key: 'd', unit: 'mcg' },
  { row: 'vitE', key: 'e', unit: 'mg' },
  { row: 'vitC', key: 'c', unit: 'mg' },
  { row: 'vitB1', key: 'b1', unit: 'mg' },
  { row: 'vitB2', key: 'b2', unit: 'mg' },
  { row: 'vitB6', key: 'b6', unit: 'mg' },
  { row: 'vitB9', key: 'b9', unit: 'mcg' },
  { row: 'vitB12', key: 'b12', unit: 'mcg' },
];

/// Detail rows for a nutrient block, in display order: extended label first
/// (fiber/sugar/saturated fat — a real 0 IS shown, it's informative), then
/// minerals, then vitamins that are actually present and non-zero (a 0 row is
/// noise). Empty result ⇒ the source gave nothing beyond КБЖУ — hide the section.
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
  for (const vr of VITAMIN_ROWS) {
    const v = values.vitamins?.[vr.key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      // Whole µg reads cleanly; sub-mg vitamins keep one decimal.
      rows.push({ key: vr.row, value: vr.unit === 'mcg' ? Math.round(v) : Math.round(v * 10) / 10, unit: vr.unit });
    }
  }
  return rows;
}
