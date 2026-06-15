import type { FoodParseResult, FoodParser, ParsedFoodItem } from './foodParser';

/**
 * OFFLINE STUB parser — no network, fully deterministic, used while live LLM
 * calls are disabled. It does a crude keyword + quantity match against a small
 * Russian food table so the food-log flow works end-to-end and is testable.
 *
 * The real implementation (claude-haiku-4-5 via the Anthropic SDK, tool use /
 * structured output, escalating to claude-sonnet-4-6 on low confidence) swaps in
 * behind the same `FoodParser` interface — see `foodParserProvider.ts`.
 */

interface FoodDef {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
}

const FOODS: { keywords: string[]; def: FoodDef }[] = [
  { keywords: ['яйц', 'яиц'], def: { name: 'Яйцо', kcal: 78, proteinG: 6.3, fatG: 5.3, carbG: 0.6 } },
  { keywords: ['омлет'], def: { name: 'Омлет', kcal: 154, proteinG: 11, fatG: 12, carbG: 1 } },
  { keywords: ['кофе'], def: { name: 'Кофе', kcal: 2, proteinG: 0.1, fatG: 0, carbG: 0 } },
  { keywords: ['молок'], def: { name: 'Молоко', kcal: 60, proteinG: 3, fatG: 3.2, carbG: 4.7 } },
  { keywords: ['хлеб', 'булк'], def: { name: 'Хлеб', kcal: 80, proteinG: 2.7, fatG: 1, carbG: 15 } },
  { keywords: ['банан'], def: { name: 'Банан', kcal: 105, proteinG: 1.3, fatG: 0.4, carbG: 27 } },
  { keywords: ['кур'], def: { name: 'Курица', kcal: 165, proteinG: 31, fatG: 3.6, carbG: 0 } },
  { keywords: ['рис'], def: { name: 'Рис', kcal: 130, proteinG: 2.7, fatG: 0.3, carbG: 28 } },
  { keywords: ['греч'], def: { name: 'Гречка', kcal: 110, proteinG: 4, fatG: 1.1, carbG: 21 } },
  { keywords: ['творог'], def: { name: 'Творог', kcal: 98, proteinG: 18, fatG: 2, carbG: 3.3 } },
  { keywords: ['ябло'], def: { name: 'Яблоко', kcal: 52, proteinG: 0.3, fatG: 0.2, carbG: 14 } },
  { keywords: ['чай'], def: { name: 'Чай', kcal: 1, proteinG: 0, fatG: 0, carbG: 0.2 } },
];

const NUM_WORDS: Record<string, number> = {
  один: 1, одно: 1, одна: 1, два: 2, две: 2, три: 3,
  трёх: 3, трех: 3, четыре: 4, пять: 5, шесть: 6,
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function quantityIn(chunk: string): number {
  const digit = chunk.match(/\d+/);
  if (digit) return Math.max(1, parseInt(digit[0], 10));
  for (const [word, n] of Object.entries(NUM_WORDS)) {
    if (chunk.includes(word)) return n;
  }
  return 1;
}

export class StubFoodParser implements FoodParser {
  async parse(utterance: string): Promise<FoodParseResult> {
    const chunks = utterance
      .toLowerCase()
      .split(/[,;]|\sи\s|\sс\s|\+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    const items: ParsedFoodItem[] = [];
    for (const chunk of chunks) {
      const match = FOODS.find((f) => f.keywords.some((k) => chunk.includes(k)));
      const qty = quantityIn(chunk);
      if (match) {
        const d = match.def;
        items.push({
          name: qty > 1 ? `${d.name} ×${qty}` : d.name,
          qtyG: null,
          kcal: round1(d.kcal * qty),
          proteinG: round1(d.proteinG * qty),
          fatG: round1(d.fatG * qty),
          carbG: round1(d.carbG * qty),
          assumptions: 'грубая офлайн-оценка (заглушка)',
        });
      } else {
        items.push({
          name: chunk,
          qtyG: null,
          kcal: 150,
          proteinG: 5,
          fatG: 5,
          carbG: 20,
          assumptions: 'неизвестный продукт — оценка по умолчанию (заглушка)',
        });
      }
    }

    const total = items.reduce(
      (acc, i) => ({
        kcal: acc.kcal + i.kcal,
        proteinG: acc.proteinG + i.proteinG,
        fatG: acc.fatG + i.fatG,
        carbG: acc.carbG + i.carbG,
      }),
      { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
    );

    return {
      items,
      kcal: round1(total.kcal),
      proteinG: round1(total.proteinG),
      fatG: round1(total.fatG),
      carbG: round1(total.carbG),
      confidence: 'low',
      needsClarification: items.length === 0,
      clarifyQuestion:
        items.length === 0 ? 'Не удалось распознать еду. Опишите подробнее?' : null,
    };
  }
}
