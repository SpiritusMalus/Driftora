import type { Minerals, NutritionSource } from '../types.js';

/**
 * One RU composition-table entry. `aliases` widen matching; `source` records the
 * provenance of the numbers (default 'skurikhin'). Entries generated from USDA
 * SR Legacy carry `source: 'usda'` so the UI attributes them honestly.
 */
export interface SkurikhinEntry {
  name: string;
  aliases: string[];
  source?: NutritionSource;
  per100: {
    kcal: number;
    prot: number;
    fat: number;
    carb: number;
    minerals: Minerals;
  };
}
