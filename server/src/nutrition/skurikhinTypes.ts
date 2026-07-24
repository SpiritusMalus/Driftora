import type { Minerals, NutritionSource, Vitamins } from '../types.js';

/**
 * One RU composition-table entry. `aliases` widen matching; `source` records the
 * provenance of the numbers (default 'skurikhin'). Entries generated from USDA
 * SR Legacy carry `source: 'usda'` so the UI attributes them honestly.
 */
export interface SkurikhinEntry {
  name: string;
  aliases: string[];
  source?: NutritionSource;
  /**
   * The row is a finished, ready-to-eat dish (суп, салат, готовое второе) —
   * per-100g describes the dish as served, so the client hides the
   * cooking-method adjustment for it. Leave unset for products people still
   * cook at home (пельмени: варят или жарят — chips stay useful).
   */
  prepared?: boolean;
  per100: {
    kcal: number;
    prot: number;
    fat: number;
    carb: number;
    /**
     * Dietary fibre (пищевые волокна), g/100 g of the row as described. Optional:
     * a row without it falls back to the USDA micro-donor back-fill (flagged as
     * an estimate). An explicit 0 is meaningful — it says "measured, none here"
     * (broth, lemonade) and blocks a proxy value being grafted on.
     */
    fiber?: number;
    minerals: Minerals;
    // Optional vitamin sub-block (same units as elsewhere: µg A/D/B9/B12, mg
    // E/C/B1/B2/B6). Present on SR-Legacy-generated rows that carried the data;
    // hand-curated composite dishes may omit it.
    vitamins?: Vitamins;
  };
}
