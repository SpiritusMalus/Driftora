import type { AudioInput, FoodParser, MealDraft, Minerals, NutritionAlternative, NutritionItem, Per100, PhotoInput, Region } from './foodParser';
import { recomputeDraft, scaleToGrams } from './mealDraft';

/**
 * OFFLINE STUB parser — no network, fully deterministic. The ULTIMATE fallback
 * (BUILD SPEC §2): used when the proxy is unreachable so the food-log flow always
 * works. It keyword-matches a tiny per-100g table and estimates a default
 * portion. Its per-100g is marked `source: 'estimate'` — honest: this is a coarse
 * offline table, NOT the real nutrition DB, so the UI shows it as an estimate.
 */

interface FoodDef {
  name_ru: string;
  name_en: string;
  defGrams: number;
  per100: Omit<Per100, 'source'>;
}

function p100(kcal: number, prot: number, fat: number, carb: number, minerals: Minerals = {}): Omit<Per100, 'source'> {
  return { kcal, prot, fat, carb, minerals };
}

const FOODS: { keywords: string[]; def: FoodDef }[] = [
  { keywords: ['яйц', 'яиц'], def: { name_ru: 'Яйцо', name_en: 'egg', defGrams: 50, per100: p100(155, 13, 11, 1.1, { na: 124, k: 126 }) } },
  { keywords: ['омлет'], def: { name_ru: 'Омлет', name_en: 'omelette', defGrams: 150, per100: p100(154, 11, 12, 1, { na: 155 }) } },
  { keywords: ['кофе'], def: { name_ru: 'Кофе', name_en: 'coffee', defGrams: 200, per100: p100(1, 0.1, 0, 0, { k: 49 }) } },
  { keywords: ['молок'], def: { name_ru: 'Молоко', name_en: 'milk', defGrams: 200, per100: p100(60, 3.2, 3.2, 4.7, { ca: 113, k: 143 }) } },
  { keywords: ['хлеб', 'булк', 'тост'], def: { name_ru: 'Хлеб', name_en: 'bread', defGrams: 30, per100: p100(265, 9, 3.2, 49, { na: 491 }) } },
  { keywords: ['банан'], def: { name_ru: 'Банан', name_en: 'banana', defGrams: 120, per100: p100(89, 1.1, 0.3, 23, { k: 358, mg: 27 }) } },
  { keywords: ['кур'], def: { name_ru: 'Курица', name_en: 'chicken breast', defGrams: 150, per100: p100(165, 31, 3.6, 0, { na: 74, k: 256 }) } },
  { keywords: ['рис'], def: { name_ru: 'Рис', name_en: 'rice', defGrams: 150, per100: p100(130, 2.7, 0.3, 28, { mg: 12 }) } },
  { keywords: ['греч'], def: { name_ru: 'Гречка', name_en: 'buckwheat', defGrams: 150, per100: p100(110, 4, 1.1, 21, { mg: 51, fe: 1.3 }) } },
  { keywords: ['творог'], def: { name_ru: 'Творог', name_en: 'cottage cheese', defGrams: 180, per100: p100(98, 18, 2, 3.3, { ca: 83, na: 364 }) } },
  { keywords: ['ябло'], def: { name_ru: 'Яблоко', name_en: 'apple', defGrams: 180, per100: p100(52, 0.3, 0.2, 14, { k: 107 }) } },
  { keywords: ['чай'], def: { name_ru: 'Чай', name_en: 'tea', defGrams: 200, per100: p100(1, 0, 0, 0.2) } },
];

const NUM_WORDS: Record<string, number> = {
  один: 1, одно: 1, одна: 1, два: 2, две: 2, три: 3,
  трёх: 3, трех: 3, четыре: 4, пять: 5, шесть: 6,
};

function quantityIn(chunk: string): number {
  const digit = chunk.match(/\d+/);
  if (digit) return Math.max(1, parseInt(digit[0], 10));
  for (const [word, n] of Object.entries(NUM_WORDS)) {
    if (chunk.includes(word)) return n;
  }
  return 1;
}

/** Coarse default per-100g for an unrecognized food — clearly an estimate. */
const UNKNOWN_PER100: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };

export class StubFoodParser implements FoodParser {
  async parse(text: string, region: Region): Promise<MealDraft> {
    const chunks = text
      .toLowerCase()
      .split(/[,;]|\sи\s|\sс\s|\+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const items: NutritionItem[] = [];
    for (const chunk of chunks) {
      const match = FOODS.find((f) => f.keywords.some((k) => chunk.includes(k)));
      const qty = quantityIn(chunk);
      if (match) {
        const grams = match.def.defGrams * qty;
        const per100: Per100 = { source: 'estimate', ...match.def.per100 };
        items.push({
          name_ru: qty > 1 ? `${match.def.name_ru} ×${qty}` : match.def.name_ru,
          name_en: match.def.name_en,
          grams,
          grams_source: 'estimated',
          confidence: 0.4,
          per100,
          scaled: scaleToGrams(per100, grams),
          approximate: true,
        });
      } else {
        items.push({
          name_ru: chunk,
          name_en: chunk,
          grams: 100,
          grams_source: 'estimated',
          confidence: 0.2,
          per100: UNKNOWN_PER100,
          scaled: scaleToGrams(UNKNOWN_PER100, 100),
          approximate: true,
        });
      }
    }

    return recomputeDraft(region, items);
  }

  /// Offline has no on-device vision — return an empty draft so the UI shows the
  /// "couldn't recognize, add detail" hint instead of breaking.
  async parsePhoto(_photo: PhotoInput, region: Region): Promise<MealDraft> {
    return recomputeDraft(region, []);
  }

  /// Offline can't transcribe + identify a voice clip — empty draft, same as
  /// photo, so the UI shows the "add detail" hint instead of breaking.
  async parseAudio(_audio: AudioInput, region: Region): Promise<MealDraft> {
    return recomputeDraft(region, []);
  }

  /// Offline has no real nutrition DB to search — return nothing so the manual
  /// picker shows "ничего не найдено" rather than offering coarse estimates.
  async searchFoods(_query: string, _region: Region): Promise<NutritionAlternative[]> {
    return [];
  }
}
