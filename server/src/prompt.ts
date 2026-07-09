import { WORKOUT_TYPE_KEYS, type Region } from './types.js';

/**
 * System prompt for IDENTIFICATION (BUILD SPEC §1/§4). The model's PRIMARY job
 * is still identification — WHICH foods and HOW MANY GRAMS. The authoritative
 * per-100g composition comes from the nutrition DB, server-side, and OVERRIDES
 * anything the model says whenever there is a good match.
 *
 * One deliberate addition (2026-07-08): the model may also give a rough per-100g
 * `estimate`. It is used ONLY (a) as a sanity-check band to catch a wrong DB
 * match (a confident lookup for the wrong food), and (b) as a last-resort
 * fallback for foods absent from every DB (e.g. regional dishes like плескавица).
 * It is always attributed as an AI estimate, never laundered as DB data.
 */
export const IDENTIFY_SYSTEM_PROMPT = `You identify the component foods in a meal description for a nutrition app. Your PRIMARY job is WHICH foods and HOW MANY GRAMS — identification, not nutrition scoring.

For each distinct food or drink in the input, output:
- name_ru: a short, normalized Russian food name (e.g. "куриная грудка", "тост").
- name_en: the same food as a short, normalized English name suitable for a USDA database search (e.g. "chicken breast", "white bread toast").
- est_grams: your best estimate of the eaten weight in grams, from explicit quantities or typical portions.
- confidence: 0..1, how sure you are about the food identity and portion.
- prepared: true when the named item is an already-prepared dish eaten as-is — soups, stews, salads, casseroles, ready composite meals (суп харчо, жаркое, плов, оливье). false for ingredients and simple products that may still be cooked or re-cooked at home (raw meat or fish, vegetables, eggs, pasta, rice, dumplings, bread).
- estimate: your best ROUGH per-100g figures for the food as typically prepared — ALL FOUR of kcal_100g, prot_100g, fat_100g, carb_100g together. See the estimate rule below.

Rules:
- Split a dish into its meaningful components (e.g. "омлет из трёх яиц" → eggs ~165 g; "кофе с молоком" → milk ~30 g; ignore water/black coffee with ~0 nutrition unless asked).
- Multiple foods in one phrase → multiple items.
- Strip filler words; never invent foods that were not mentioned.
- The estimate is a SANITY-CHECK and last-resort fallback only — the nutrition DB is authoritative and overrides your numbers whenever it has a good match. When you give an estimate, provide ALL FOUR fields together and roughly self-consistent (kcal ≈ 4×protein + 9×fat + 4×carbs) — a partial estimate (e.g. protein only) is useless, so it is all four or none. Base them on what the food actually is (плескавица ≈ grilled minced-meat patty ≈ 230 kcal, 17 g protein, 16 g fat, 3 g carbs per 100 g). Omit the whole estimate object only for something you genuinely cannot identify — never a partial estimate, never generic padding.
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
          estimate: {
            type: 'object',
            description: 'Rough per-100g figures from the model — a sanity-check / last-resort fallback, never authoritative. Provide ALL FOUR fields together (kcal_100g, prot_100g, fat_100g, carb_100g) or omit the whole object — never a partial estimate.',
            properties: {
              kcal_100g: { type: ['number', 'null'] },
              prot_100g: { type: ['number', 'null'] },
              fat_100g: { type: ['number', 'null'] },
              carb_100g: { type: ['number', 'null'] },
            },
          },
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
          estimate: {
            type: 'object',
            description: 'Rough per-100g figures from the model — a sanity-check / last-resort fallback, never authoritative. Provide ALL FOUR fields together (kcal_100g, prot_100g, fat_100g, carb_100g) or omit the whole object — never a partial estimate.',
            properties: {
              kcal_100g: { type: ['number', 'null'] },
              prot_100g: { type: ['number', 'null'] },
              fat_100g: { type: ['number', 'null'] },
              carb_100g: { type: ['number', 'null'] },
            },
          },
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
 * The model transcribes internally, then identifies foods + grams (+ the rough
 * `estimate` from the system prompt). Uses the base IDENTIFY_SCHEMA.
 */
export function userAudioInstruction(region: Region): string {
  return `Region: ${region}. The audio is a person describing, in Russian, a meal they ate. Understand what they said, then identify the foods and estimate grams. Identification and grams are your primary job; the nutrition DB is authoritative for numbers.`;
}

/**
 * System prompt for WORKOUT parsing. Symmetric to food: the model's job is to
 * PARSE a free-text activity description into structured entries (type +
 * minutes, and pace where it applies) — it does NOT compute calories. The app
 * computes kcal on-device from the user's weight (MET × kg × hours), so no
 * energy numbers cross the wire. The one exception is `met` for `type: "other"`:
 * an activity outside the fixed list has no app-side MET, so the model supplies
 * a rough one — clearly a model estimate, flagged as such in the UI.
 */
export const PARSE_WORKOUT_SYSTEM_PROMPT = `You parse a free-text description of physical activity / a workout into structured entries for a fitness app. You do NOT compute calories — the app does that from the user's weight. Your job is: WHICH activities, HOW LONG, and (where it applies) HOW FAST.

Map each activity to exactly ONE type:
walk, run, cycle, swim, strength, hiit, elliptical, row, sport, dance, martial, yoga — or "other" only when none genuinely fits.

For each activity output:
- type: one of the keys above, or "other".
- name_ru: a short Russian label of what was actually done (e.g. "отжимания", "приседания", "бег", "планка").
- minutes: duration in minutes (integer-ish). If the user gave REPS or SETS instead of a time, ESTIMATE the minutes it realistically takes, including short rests (e.g. 100 отжиманий за несколько подходов ≈ 8 мин; 3×15 приседаний ≈ 6 мин; планка 3×1 мин ≈ 4 мин). If a duration is stated, use it. minutes must be > 0.
- speed_kmh: for walk / run / cycle ONLY, the pace in km/h when the user stated or clearly implied one ("бежал 10 км/ч", "10 км за час" → 10; "5 км за 30 минут" → 10). Omit when no pace is given — do NOT guess a pace.
- met: ONLY when type is "other". Give your best MET (metabolic-equivalent) for that activity at the described effort (e.g. отжимания ≈ 8, планка ≈ 3, скакалка ≈ 12, гребной тренажёр уже есть как "row"). Omit met for every known type — the app has its own.
- confidence: 0..1.

Classification rules:
- Bodyweight strength moves (отжимания, подтягивания, приседания, выпады, планка) → "strength".
- Explicitly cardio-for-time bursts (бёрпи, джампинг-джек, табата, круговая) → "hiit".
- Ball / team games (футбол, баскетбол, волейбол, теннис) → "sport".
- Several activities in one description → several entries.
- Never invent an activity that was not mentioned. If there is nothing activity-like, return an empty workouts array.`;

export function userWorkoutInstruction(): string {
  return `Parse the workout description below into structured activities (type, minutes, pace where applicable). Do not compute calories.`;
}

/** JSON Schema for workout parsing — structured output, no nutrition numbers. */
export const PARSE_WORKOUT_SCHEMA = {
  type: 'object',
  properties: {
    workouts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...WORKOUT_TYPE_KEYS] },
          name_ru: { type: 'string' },
          minutes: { type: 'number' },
          speed_kmh: { type: ['number', 'null'] },
          met: { type: ['number', 'null'], description: 'Model MET estimate — ONLY for type "other". Omit for known types.' },
          confidence: { type: 'number' },
        },
        required: ['type', 'name_ru', 'minutes', 'confidence'],
      },
    },
  },
  required: ['workouts'],
} as const;
