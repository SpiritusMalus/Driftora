import type { SkurikhinEntry } from './skurikhinTypes.js';

/**
 * Hand-curated RU composition rows for common foods ABSENT from the
 * USDA-SR-Legacy import in `skurikhinData.ts` (that file is auto-generated — do
 * not hand-edit it; add to this list instead). These are everyday RU items
 * (выпечка / готовые блюда) the resolver otherwise missed → fell back to the
 * coarse `estimate`, which the UI shows as "not in our database".
 *
 * Per-100g values are standard published Russian composition figures; provenance
 * is attributed as 'skurikhin' (curated RU table) so the UI labels them honestly.
 * Minerals are left empty for now (macros are the figures we can stand behind).
 */
export const CURATED_RU: SkurikhinEntry[] = [
  { name: 'пончик', aliases: ['пончик', 'пончики', 'пышка', 'пышки'], source: 'skurikhin',
    per100: { kcal: 296, prot: 5.8, fat: 13, carb: 38.8, minerals: {} } },
  { name: 'булочка', aliases: ['булочка', 'булка', 'сдоба', 'сдобная булочка'], source: 'skurikhin',
    per100: { kcal: 339, prot: 7.9, fat: 9.4, carb: 55.5, minerals: {} } },
  { name: 'пирожок', aliases: ['пирожок', 'пирожки'], source: 'skurikhin',
    per100: { kcal: 294, prot: 7.7, fat: 7, carb: 50, minerals: {} } },
  { name: 'блины', aliases: ['блины', 'блин', 'блинчик', 'блинчики'], source: 'skurikhin',
    per100: { kcal: 233, prot: 6.1, fat: 12.3, carb: 26, minerals: {} } },
  { name: 'оладьи', aliases: ['оладьи', 'оладья', 'оладушки'], source: 'skurikhin',
    per100: { kcal: 295, prot: 6.4, fat: 9, carb: 46, minerals: {} } },
  { name: 'пельмени', aliases: ['пельмени', 'пельмень'], source: 'skurikhin',
    per100: { kcal: 275, prot: 11.9, fat: 12.4, carb: 29, minerals: {} } },
  { name: 'печенье', aliases: ['печенье', 'печеньки'], source: 'skurikhin',
    per100: { kcal: 417, prot: 7.5, fat: 11.8, carb: 74.4, minerals: {} } },
];
