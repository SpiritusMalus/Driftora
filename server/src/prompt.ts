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
 * PHOTO system prompt. Identification works exactly as above, PLUS one addition
 * that only makes sense for an image: reading a printed nutrition panel.
 *
 * This does NOT break THE HONESTY RULE. The rule forbids the model from
 * *estimating* nutrition numbers. Transcribing numbers that are printed on the
 * package in the photo is not estimation — it is reading ground truth, and it
 * is strictly better than looking up a generic database average. The rule still
 * holds for everything the model cannot read off a label.
 */
export const IDENTIFY_PHOTO_SYSTEM_PROMPT = `${IDENTIFY_SYSTEM_PROMPT}

PACKAGED PRODUCTS — READING THE LABEL (photos only):
Some photos show a packaged product (a tub, cup, bottle, wrapper) with a printed
nutrition panel ("Пищевая ценность на 100 г", "Nutrition Facts") and/or a net
weight ("масса нетто", "нетто", printed grams). When such a product is present:
- Add a "label" object to that food item with the values PRINTED ON THE PACKAGE,
  per 100 g: kcal_100g, prot_100g, fat_100g, carb_100g, and net_weight_g from the
  net weight. Front-of-pack callouts count too (e.g. "14 г белки" per 100 g,
  "34 г белка в упаковке" — but only put PER-100g numbers in the *_100g fields).
- TRANSCRIBE ONLY. Copy the exact printed digits. If a number is not clearly
  legible, OMIT that field — never guess, never round to a "typical" value, never
  fill it from what you think the product usually contains. A partial label (only
  protein legible) is fine: include what you can read, omit the rest.
- Do this ONLY for a genuine printed panel/weight. A plate of food, a menu, or a
  product with no visible numbers gets NO label object — those go through the
  normal database path.
Non-packaged foods and every field you cannot read stay identification-only, per
the rules above.`;

export function userPhotoInstruction(region: Region): string {
  return `Region: ${region}. Identify the foods and estimate grams. If the photo shows a packaged product with a legible nutrition panel or net weight, also transcribe those printed numbers into the item's "label".`;
}

/**
 * Photo JSON schema: identification + an OPTIONAL per-item `label` block for
 * numbers read off the package. Every label field is optional (nullable): the
 * model fills only what it can actually read.
 */
export const IDENTIFY_PHOTO_SCHEMA = {
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
          label: {
            type: 'object',
            description: 'Numbers transcribed off a printed package label, when visible. Omit entirely for non-packaged food.',
            properties: {
              kcal_100g: { type: ['number', 'null'] },
              prot_100g: { type: ['number', 'null'] },
              fat_100g: { type: ['number', 'null'] },
              carb_100g: { type: ['number', 'null'] },
              net_weight_g: { type: ['number', 'null'] },
            },
          },
        },
        required: ['name_ru', 'name_en', 'est_grams', 'confidence', 'prepared'],
      },
    },
  },
  required: ['items'],
} as const;

/**
 * Instruction for AUDIO input: a person describing, in Russian, what they ate.
 * The model transcribes internally, then identifies foods + grams — still NO
 * nutrition numbers (those come from the DB). Same JSON schema as text/photo.
 */
export function userAudioInstruction(region: Region): string {
  return `Region: ${region}. The audio is a person describing, in Russian, a meal they ate. Understand what they said, then identify the foods and estimate grams. Identification and grams only — never calories, macros, or minerals.`;
}
