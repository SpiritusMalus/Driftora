import type { Region } from './types.js';

/**
 * System prompt for IDENTIFICATION ONLY (BUILD SPEC §1/§4). The model lists the
 * component foods and ESTIMATES grams + a confidence — it must NEVER output
 * nutrition numbers (kcal/macros/minerals). Those come from the nutrition DB,
 * server-side; anything the model emits about them would be ignored anyway.
 */
export const IDENTIFY_SYSTEM_PROMPT = `You identify the component foods in a meal description for a nutrition app. You DO NOT estimate calories, macros, or minerals — only WHICH foods and HOW MANY GRAMS.

For each distinct food or drink in the input, output:
- name_ru: a short, normalized Russian food name (e.g. "куриная грудка", "тост").
- name_en: the same food as a short, normalized English name suitable for a USDA database search (e.g. "chicken breast", "white bread toast").
- est_grams: your best estimate of the eaten weight in grams, from explicit quantities or typical portions.
- confidence: 0..1, how sure you are about the food identity and portion.

Rules:
- Split a dish into its meaningful components (e.g. "омлет из трёх яиц" → eggs ~165 g; "кофе с молоком" → milk ~30 g; ignore water/black coffee with ~0 nutrition unless asked).
- Multiple foods in one phrase → multiple items.
- Strip filler words; never invent foods that were not mentioned.
- NEVER output calories, protein, fat, carbs, or minerals. Identification and grams only.
- If nothing food-like is present, return an empty items array.`;

/** Gemini structured-output schema (OpenAPI subset) — identification only. */
export const IDENTIFY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name_ru: { type: 'STRING' },
          name_en: { type: 'STRING' },
          est_grams: { type: 'NUMBER' },
          confidence: { type: 'NUMBER' },
        },
        required: ['name_ru', 'name_en', 'est_grams', 'confidence'],
        propertyOrdering: ['name_ru', 'name_en', 'est_grams', 'confidence'],
      },
    },
  },
  required: ['items'],
} as const;

export function userInstruction(region: Region): string {
  return `Region: ${region}. Identify the foods and estimate grams for the meal below.`;
}
