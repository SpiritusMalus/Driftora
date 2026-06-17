import type Anthropic from '@anthropic-ai/sdk';

/**
 * System prompt for the food parser (handoff §9). Russian in, Russian out.
 * Honesty over false precision: rough guess → low confidence + assumptions;
 * a calorie-defining ambiguity → one short clarify question instead of guessing.
 */
export const SYSTEM_PROMPT = `Ты — парсер еды для русскоязычного приложения учёта питания. Извлекай из фразы все блюда и напитки и оценивай их КБЖУ.

Для каждого блюда заполни:
- name: короткое нормализованное русское название.
- qtyG: масса в граммах, если выводима из фразы или типичной порции; иначе null.
- kcal/proteinG/fatG/carbG: на фактическое съеденное количество (НЕ на 100 г).
- assumptions: что ты предположил (порция, жирность молока, способ готовки), кратко по-русски; "" если допущений нет.

Правила:
- Несколько блюд в одной фразе → несколько элементов items.
- Двусмысленность, сильно влияющая на калории (количество сахара, размер порции, жирность) → needsClarification: true и ОДИН короткий вопрос на русском в clarifyQuestion. В этом случае items можно оставить пустым.
- confidence: "high" — явные количества и известные продукты; "medium" — типичные допущения; "low" — грубая прикидка.
- Если фразу невозможно сопоставить с едой — верни пустой items, needsClarification: false.
- Не выдумывай ложную точность. Лучше честная грубая оценка с low + assumptions, чем выдуманные числа.
- Всегда отвечай ТОЛЬКО вызовом инструмента report_food. Никакой прозы.`;

/** The single forced tool. Mirrors `LlmFoodPayload`; totals are recomputed server-side. */
export const FOOD_TOOL: Anthropic.Tool = {
  name: 'report_food',
  description: 'Сообщить распознанные блюда с оценкой КБЖУ. Вызывай ровно один раз.',
  // @ts-expect-error — strict structured-tool flag is GA but not yet in this SDK's Tool type.
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        description: 'Распознанные блюда. Может быть пустым при needsClarification или нераспознанной фразе.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Нормализованное русское название блюда.' },
            qtyG: { type: ['number', 'null'], description: 'Масса в граммах или null.' },
            kcal: { type: 'number', description: 'Калории на фактическую порцию (целое).' },
            proteinG: { type: 'number', description: 'Белки, г.' },
            fatG: { type: 'number', description: 'Жиры, г.' },
            carbG: { type: 'number', description: 'Углеводы, г.' },
            assumptions: { type: 'string', description: 'Допущения по-русски или "".' },
          },
          required: ['name', 'qtyG', 'kcal', 'proteinG', 'fatG', 'carbG', 'assumptions'],
        },
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Общая уверенность в оценке.',
      },
      needsClarification: {
        type: 'boolean',
        description: 'true, если нужен один уточняющий вопрос вместо итога.',
      },
      clarifyQuestion: {
        type: ['string', 'null'],
        description: 'Один короткий вопрос на русском, если needsClarification; иначе null.',
      },
    },
    required: ['items', 'confidence', 'needsClarification', 'clarifyQuestion'],
  },
};
