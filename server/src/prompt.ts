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
- prepared: true when the named item is an already-prepared dish eaten as-is — soups, stews, salads, casseroles, ready composite meals (суп харчо, жаркое, плов, оливье). false for ingredients and simple products that may still be cooked or re-cooked at home (raw meat or fish, vegetables, eggs, pasta, rice, dumplings, bread).

Rules:
- Split a dish into its meaningful components (e.g. "омлет из трёх яиц" → eggs ~165 g; "кофе с молоком" → milk ~30 g; ignore water/black coffee with ~0 nutrition unless asked).
- Multiple foods in one phrase → multiple items.
- Strip filler words; never invent foods that were not mentioned.
- NEVER output calories, protein, fat, carbs, or minerals. Identification and grams only.
- If nothing food-like is present, return an empty items array.`;

/**
 * JSON Schema for structured output — identification only. Passed to OpenRouter
 * as `response_format.json_schema.schema` (OpenAI Chat-Completions format).
 */
export const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name_ru: { type: 'string' },
          name_en: { type: 'string' },
          est_grams: { type: 'number' },
          confidence: { type: 'number' },
          prepared: { type: 'boolean' },
        },
        required: ['name_ru', 'name_en', 'est_grams', 'confidence', 'prepared'],
      },
    },
  },
  required: ['items'],
} as const;

export function userInstruction(region: Region): string {
  return `Region: ${region}. Identify the foods and estimate grams for the meal below.`;
}

/**
 * Instruction for AUDIO input: a person describing, in Russian, what they ate.
 * The model transcribes internally, then identifies foods + grams — still NO
 * nutrition numbers (those come from the DB). Same JSON schema as text/photo.
 */
export function userAudioInstruction(region: Region): string {
  return `Region: ${region}. The audio is a person describing, in Russian, a meal they ate. Understand what they said, then identify the foods and estimate grams. Identification and grams only — never calories, macros, or minerals.`;
}
