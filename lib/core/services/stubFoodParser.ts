import type { AudioInput, BarcodeLookup, FoodParser, MealDraft, Minerals, NutritionAlternative, NutritionItem, Per100, PhotoInput, Region } from './foodParser';
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
  { keywords: ['яйц', 'яиц', 'egg'], def: { name_ru: 'Яйцо', name_en: 'egg', defGrams: 50, per100: p100(155, 13, 11, 1.1, { na: 124, k: 126 }) } },
  { keywords: ['омлет', 'omelet'], def: { name_ru: 'Омлет', name_en: 'omelette', defGrams: 150, per100: p100(154, 11, 12, 1, { na: 155 }) } },
  { keywords: ['кофе', 'coffee'], def: { name_ru: 'Кофе', name_en: 'coffee', defGrams: 200, per100: p100(1, 0.1, 0, 0, { k: 49 }) } },
  { keywords: ['молок', 'milk'], def: { name_ru: 'Молоко', name_en: 'milk', defGrams: 200, per100: p100(60, 3.2, 3.2, 4.7, { ca: 113, k: 143 }) } },
  { keywords: ['хлеб', 'булк', 'тост', 'bread'], def: { name_ru: 'Хлеб', name_en: 'bread', defGrams: 30, per100: p100(265, 9, 3.2, 49, { na: 491 }) } },
  { keywords: ['банан', 'banana'], def: { name_ru: 'Банан', name_en: 'banana', defGrams: 120, per100: p100(89, 1.1, 0.3, 23, { k: 358, mg: 27 }) } },
  { keywords: ['кур', 'chicken'], def: { name_ru: 'Курица', name_en: 'chicken breast', defGrams: 150, per100: p100(165, 31, 3.6, 0, { na: 74, k: 256 }) } },
  { keywords: ['рис', 'rice'], def: { name_ru: 'Рис', name_en: 'rice', defGrams: 150, per100: p100(130, 2.7, 0.3, 28, { mg: 12 }) } },
  { keywords: ['греч', 'buckwheat'], def: { name_ru: 'Гречка', name_en: 'buckwheat', defGrams: 150, per100: p100(110, 4, 1.1, 21, { mg: 51, fe: 1.3 }) } },
  { keywords: ['творог', 'cottage cheese'], def: { name_ru: 'Творог', name_en: 'cottage cheese', defGrams: 180, per100: p100(98, 18, 2, 3.3, { ca: 83, na: 364 }) } },
  { keywords: ['ябло', 'apple'], def: { name_ru: 'Яблоко', name_en: 'apple', defGrams: 180, per100: p100(52, 0.3, 0.2, 14, { k: 107 }) } },
  { keywords: ['чай', 'tea'], def: { name_ru: 'Чай', name_en: 'tea', defGrams: 200, per100: p100(1, 0, 0, 0.2) } },
];

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  один: 1, одно: 1, одна: 1, два: 2, две: 2, три: 3,
  трёх: 3, трех: 3, четыре: 4, пять: 5, шесть: 6,
};

function quantityIn(chunk: string): number {
  // Label percentages and volume units aren't counts of whole foods. Only an
  // explicit mass below can replace the estimated portion in those cases.
  const countText = chunk.replace(/\d+(?:[.,]\d+)?\s*(?:%|мл|ml|литр(?:а|ов)?|lit(?:er|re)s?)(?=$|[^a-zа-яё])/gu, ' ');
  const digit = countText.match(/\d+(?:[.,]\d+)?/);
  if (digit) return Math.max(1, Number(digit[0].replace(',', '.')));
  for (const [word, n] of Object.entries(NUM_WORDS)) {
    if (new RegExp(`(?:^|[^a-zа-яё])${word}(?=$|[^a-zа-яё])`, 'u').test(countText)) return n;
  }
  return 1;
}

function gramsIn(chunk: string): number | null {
  const mass = chunk.match(/(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|кг|килограмм(?:а|ов)?|grams?|g|грамм(?:а|ов)?|гр\.?|г)(?=$|[\s,;.)])/u);
  if (!mass) return null;
  const grams = Number(mass[1].replace(',', '.')) * (/^(?:k|к)/u.test(mass[2]) ? 1000 : 1);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

/** Coarse default per-100g for an unrecognized food — clearly an estimate. */
const UNKNOWN_PER100: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };

export class StubFoodParser implements FoodParser {
  async parse(text: string, region: Region): Promise<MealDraft> {
    const chunks = text
      .toLowerCase()
      // Decimal commas belong to the amount, not the meal's item separator.
      .replace(/(\d),(\d)/g, '$1.$2')
      .split(/[,;]|\sи\s|\sс\s|\sand\s|\swith\s|\+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const items: NutritionItem[] = [];
    for (const chunk of chunks) {
      const match = FOODS.find((f) => f.keywords.some((k) => chunk.includes(k)));
      const explicitGrams = gramsIn(chunk);
      const qty = explicitGrams == null ? quantityIn(chunk) : 1;
      if (match) {
        const grams = explicitGrams ?? match.def.defGrams * qty;
        const per100: Per100 = { source: 'estimate', ...match.def.per100 };
        items.push({
          name_ru: qty > 1 ? `${match.def.name_ru} ×${qty}` : match.def.name_ru,
          name_en: qty > 1 ? `${match.def.name_en} ×${qty}` : match.def.name_en,
          grams,
          grams_source: explicitGrams == null ? 'estimated' : 'confirmed',
          confidence: 0.4,
          per100,
          scaled: scaleToGrams(per100, grams),
          approximate: explicitGrams == null,
        });
      } else {
        items.push({
          name_ru: chunk,
          name_en: chunk,
          grams: explicitGrams ?? 100,
          grams_source: explicitGrams == null ? 'estimated' : 'confirmed',
          confidence: 0.2,
          per100: UNKNOWN_PER100,
          scaled: scaleToGrams(UNKNOWN_PER100, explicitGrams ?? 100),
          approximate: explicitGrams == null,
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

  /// Базы продуктов на устройстве нет, поэтому по коду ответить нечем — и это
  /// честный «не знаю», а не «такого продукта не существует».
  async lookupBarcode(_code: string, _region: Region): Promise<BarcodeLookup> {
    return { item: null };
  }

  /// Nothing leaves an offline device. This is also the parser the app holds
  /// whenever AI consent is absent, which makes the no-op a GUARANTEE and not
  /// just a fallback: without consent there is no path from here to the shared
  /// base at all, whatever the sharing setting says.
  async contributeFood(): Promise<void> {}
}
