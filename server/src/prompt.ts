import { STRENGTH_INTENSITY_KEYS, WORKOUT_TYPE_KEYS, type Region } from './types.js';

/**
 * System prompt for AUDIO identification (BUILD SPEC §1/§4). The model's PRIMARY
 * job is identification — WHICH foods and HOW MANY GRAMS; the authoritative
 * per-100g composition comes from the nutrition DB, server-side.
 *
 * AUDIO-ONLY as of 2026-07-20: the text path moved to the slim
 * IDENTIFY_TEXT_* contract below (no `estimate` — the numeric block is where
 * the decode loop lives, and the resolver now fetches estimates on demand).
 * Audio deliberately KEEPS the legacy contract: it proved the most fragile path
 * in this session's experiments (a schema tweak that helped photos degraded
 * voice 3/3), so it changes only WITH its own measurements, not alongside.
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
- The estimate is a SANITY-CHECK and last-resort fallback only — the nutrition DB is authoritative and overrides your numbers whenever it has a good match. When you give an estimate, provide ALL FOUR fields together and roughly self-consistent (kcal ≈ 4×protein + 9×fat + 4×carbs) — a partial estimate (e.g. protein only) is useless, so it is all four or none. Base them on what the food actually is (плескавица ≈ grilled minced-meat patty ≈ 230 kcal, 17 g protein, 16 g fat, 3 g carbs per 100 g). A BRANDED, regional or unfamiliar product is NOT a reason to omit it — estimate from the product CLASS (лимонад «Тархун» Черноголовка ≈ a sweet carbonated soft drink ≈ 30 kcal, 0 g protein, 0 g fat, 8 g carbs per 100 g). The DB frequently lacks such products, and your estimate is the only thing standing between the user and a wrong row. Omit the whole estimate object only when you genuinely cannot tell what KIND of food it is — never a partial estimate, never generic padding.
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
 * TEXT identification — slim contract, mirroring the photo one (2026-07-20).
 *
 * The legacy prompt asked every text parse for a per-100g `estimate` "just in
 * case": four numeric literals per item that the DB overrides on any decent
 * match. Measured cost of that habit on this model: the decode loop lives INSIDE
 * numeric literals («"prot_100g": 29.02e0200000…»), and «борщ и два куска
 * чёрного хлеба» failed 3/3 exactly like the photos did. The estimate still
 * exists — the resolver fetches it on demand (`estimateFoodPer100`) for the few
 * rows that actually need one (DB miss, weak match, unhonored grade), instead of
 * every item paying for it up front. Prompt drops from ~620 to ~300 tokens.
 */
export const IDENTIFY_TEXT_SYSTEM_PROMPT = `You identify the component foods in a meal description for a nutrition app. Your ONLY job is WHICH foods and HOW MANY GRAMS — identification, not nutrition scoring. The app looks up every nutrition number itself, from a database.

For each distinct food or drink in the input, output:
- name_ru: a short, normalized Russian food name (e.g. "куриная грудка", "тост").
- name_en: the same food as a short, normalized English name suitable for a USDA database search (e.g. "chicken breast", "white bread toast").
- est_grams: your best estimate of the eaten weight in grams, from explicit quantities or typical portions.
- confidence: 0..1, how sure you are about the food identity and portion.
- prepared: true when the named item is an already-prepared dish eaten as-is — soups, stews, salads, casseroles, ready composite meals (суп харчо, жаркое, плов, оливье). false for ingredients and simple products that may still be cooked or re-cooked at home (raw meat or fish, vegetables, eggs, pasta, rice, dumplings, bread).

Rules:
- Split a dish into its meaningful components (e.g. "омлет из трёх яиц" → eggs ~165 g; "кофе с молоком" → milk ~30 g; ignore water/black coffee with ~0 nutrition unless asked).
- Multiple foods in one phrase → multiple items.
- Strip filler words; never invent foods that were not mentioned. KEEP brand and grade words in name_ru («творог 5%», «лимонад Тархун Черноголовка») — they are what lets the database find the right row.
- If nothing food-like is present, return an empty items array.`;

/** Slim text schema: identification only, no numeric blocks for a loop to live in. */
export const IDENTIFY_TEXT_SCHEMA = {
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

/**
 * MANUAL-SEARCH AI ESTIMATE. The user typed a food name into the search box and
 * we show your per-100g guess ALONGSIDE the database rows, clearly flagged «≈».
 * This is the sanctioned, attributed AI-estimate path (never laundered as DB
 * data), so — unlike identification — you ALWAYS answer with numbers, never
 * refuse or omit. Its whole value is interpreting BRAND and INTENT, which the
 * generic databases can't.
 */
export const ESTIMATE_SEARCH_SYSTEM_PROMPT = `You estimate the nutrition of ONE food a user typed into a manual food-search box. Return your BEST per-100g figures for that food AS the user most likely means it.

- ALWAYS answer — this is an explicitly-labelled estimate («≈» in the UI), so you never refuse, never omit fields, never say "unknown". Give your best guess even for an obscure or branded item.
- Interpret INTENT and BRANDS from ANY country or cuisine — «масло простоквашино», «Nutella», «Coca-Cola Zero», «President camembert», «Barilla penne» all name a specific product; use that product's typical values. When no brand is named, use the generic food. Fix obvious typos/half-words to the food the user meant.
- Give ALL FOUR numbers per 100 g — kcal, protein, fat, carbs — roughly self-consistent (kcal ≈ 4×protein + 9×fat + 4×carbs). Whole or one-decimal numbers are fine.
- name_ru: a short, clean Russian name for what you estimated; KEEP the brand if the user named one.`;

export const ESTIMATE_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    name_ru: { type: 'string', description: 'Short clean Russian name for the estimated food; keep the brand if the user named one.' },
    kcal_100g: { type: 'number' },
    prot_100g: { type: 'number' },
    fat_100g: { type: 'number' },
    carb_100g: { type: 'number' },
  },
  required: ['name_ru', 'kcal_100g', 'prot_100g', 'fat_100g', 'carb_100g'],
} as const;

export function userEstimateSearchInstruction(region: Region, name: string): string {
  return `Region: ${region}. Estimate the per-100g nutrition for this food the user typed:\n\n${name}`;
}

// DISPLAY-ONLY translation of English nutrition-DB row labels (FatSecret/USDA)
// into short Russian names, so the RU user reads «Рис с молоком» instead of
// «Rice with Milk» (device feedback 2026-07-18). It touches NO numbers — the
// per-100g composition and the «по базе …» source tag are untouched; only the
// human label is localized. One batched call per meal, results cached by string.
export const TRANSLATE_LABELS_SYSTEM_PROMPT = `You translate short food/database labels from English into Russian for display in a food-logging app.

- Return a SHORT, natural Russian food name for EACH input, in the SAME ORDER and the SAME COUNT.
- Keep brand names (Latin brands may stay Latin, e.g. «Nutella»); translate the generic food words around them.
- NO notes, quantities, parentheses-explanations, or extra words — just the name.
- If an input is ALREADY Russian, return it unchanged.
- Never drop, merge, or add entries: exactly one output per input.`;

export const TRANSLATE_LABELS_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      description: 'Short Russian food names, one per input label, in the same order.',
      items: { type: 'string' },
    },
  },
  required: ['translations'],
} as const;

export function userTranslateLabelsInstruction(labels: string[]): string {
  const list = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `Translate these ${labels.length} food labels to short Russian names, preserving order and count:\n\n${list}`;
}

/**
 * PHOTO system prompt — identification ONLY, deliberately narrower than the text
 * one (2026-07-20).
 *
 * It used to inherit the text prompt wholesale and ask for per-100g `estimate`
 * numbers plus a transcribed `label` on top of naming the food. Measured on the
 * tester's own photos, that combination failed 5 requests out of 10: the model
 * fell into a degenerate decode loop INSIDE the numeric literals
 * («"prot_100g": 29.02e0200000…»), burned the whole token ceiling and returned
 * nothing. Dropping the numbers from the photo contract took the same photos to
 * 10/10 — and identification got BETTER, not worse: the composite lunch box
 * resolved into all five components instead of four, with brand names intact
 * («Ветчина из грудки индейки Индилайт»), because the budget goes to seeing
 * rather than to inventing nutrition it does not know.
 *
 * So the split is now clean: the photo call SEES, the database KNOWS. A food the
 * DB misses gets its estimate from a separate, text-only call over the name
 * (`estimateFoodPer100`) — cheap, and it cannot take the vision call down with
 * it. Label transcription returns as its own dedicated call once a package is
 * detected; a plate of soup no longer pays for it.
 */
export const IDENTIFY_PHOTO_SYSTEM_PROMPT = `You identify the component foods in a meal PHOTO for a nutrition app. Your ONLY job is WHICH foods and HOW MANY GRAMS — identification, not nutrition scoring. The app looks up every nutrition number itself, from a database.

For each distinct food or drink visible, output:
- name_ru: a short, normalized Russian food name ("куриная грудка", "макароны отварные").
- name_en: the same food as a short, normalized English name suitable for a USDA database search.
- est_grams: your best estimate of the eaten weight in grams, from the visible portion.
- confidence: 0..1, how sure you are about the food identity and portion.
- prepared: true when the item is an already-prepared dish eaten as-is (soup, stew, salad, casserole, ready meal); false for ingredients and simple products.

Rules:
- Split a composite plate into its meaningful COMPONENTS — name every distinct food you can see, including the ones hidden under a sauce or a topping.
- Never invent foods that are not visible.
- If the photo shows a packaged product, name the PRODUCT, brand included when it is legible («Ветчина из грудки индейки Индилайт») — the brand is what lets the database find the right row.
- packaged: true ONLY when that item is a packaged product whose wrapper carries a PRINTED nutrition panel or net weight — a tub, pack, bottle or bar, whether or not you can read the small print from here. A plate, a bowl, a restaurant dish or loose fruit is false. The app runs a second, dedicated pass to read the panel on anything you mark, so flag it and let that pass do the reading; you do NOT transcribe any numbers here.
- If nothing food-like is present, return an empty items array.`;

export function userPhotoInstruction(region: Region): string {
  return `Region: ${region}. Identify the foods and estimate grams.`;
}

/**
 * Photo JSON schema — identification only, NO nutrition numbers.
 *
 * The absent `estimate`/`label` blocks are the point, not an omission: those
 * numeric fields were where the decode loop lived, and every long numeric
 * literal the model has to produce is another chance to fall into it. Nutrition
 * comes from the database; a DB miss is filled by a separate text-only estimate
 * over the name. See IDENTIFY_PHOTO_SYSTEM_PROMPT for the measurements.
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
          packaged: {
            type: 'boolean',
            description:
              'This item is a packaged product whose wrapper carries a printed nutrition panel or net weight. Triggers a second, dedicated pass that reads the panel; no numbers are transcribed in this response.',
          },
        },
        required: ['name_ru', 'name_en', 'est_grams', 'confidence', 'prepared'],
      },
    },
  },
  required: ['items'],
} as const;

/**
 * DEDICATED LABEL PASS. Runs only when the identification pass flagged a
 * `packaged` item, so a plate of soup never pays for it — and, having one job,
 * it can afford to look hard at small rotated print.
 *
 * It asks for the SAME numbers twice, by two different routes: `panel_text` (the
 * phrase copied verbatim) and `label` (the model's own mapping). The server
 * re-derives the numbers from the phrase, where the Russian WORD decides which
 * field a digit belongs to, and keeps them only when both readings agree —
 * see `crossCheckLabel`. Two independent readings are the only defence against
 * a confidently mis-assigned macro, which an Atwater check cannot catch (fat 2 /
 * carb 4 and fat 4 / carb 2 both land within a few kcal of a stated 100).
 */
export const READ_LABEL_SYSTEM_PROMPT = `You read the printed NUTRITION PANEL off a packaged food product in a photo. You do not identify food, estimate anything, or judge portions — you TRANSCRIBE what is printed.

Return, for the package in the photo:
- panel_text: the panel copied VERBATIM — the Russian words together with their numbers and units, in the order printed, net weight included. For example: "Пищевая и энергетическая ценность в 100 г продукта (средние значения): белки — 16 г; жиры — 2 г; углеводы — 4 г; 100 ккал/410 кДж. Масса нетто: 120 г". Copy; never reorder, convert, round or interpret. The panel is often small, low-contrast, and printed sideways along an edge — read it anyway, rotating your attention as needed.
- label: the same numbers placed into fields, per 100 g — kcal_100g, prot_100g, fat_100g, carb_100g — plus net_weight_g from «масса нетто».

Rules:
- TRANSCRIBE ONLY. Copy the exact printed digits. Never guess a number, never round to a "typical" value for the product, never fill a field from what you think this food usually contains.
- The Russian block prints белки / жиры / углеводы as a trio beside the ккал figure. Read the whole block, and take care that each number keeps its own word — жиры and углеводы are easy to swap and the app cannot tell which way is right.
- If a figure genuinely is not legible, omit that field. An honest gap is fine; an invented number is not.
- If there is no printed panel at all, return an empty panel_text and no label.`;

export const READ_LABEL_SCHEMA = {
  type: 'object',
  properties: {
    panel_text: {
      type: 'string',
      description: 'The nutrition panel copied verbatim, words and numbers together, in printed order. Empty when no panel is visible.',
    },
    label: {
      type: 'object',
      description: 'The same printed numbers placed into fields, per 100 g. Omit any field that is not legible.',
      properties: {
        kcal_100g: { type: ['number', 'null'] },
        prot_100g: { type: ['number', 'null'] },
        fat_100g: { type: ['number', 'null'] },
        carb_100g: { type: ['number', 'null'] },
        net_weight_g: { type: ['number', 'null'] },
      },
    },
  },
  required: ['panel_text'],
} as const;

export function userReadLabelInstruction(productName: string): string {
  return `The package in this photo is «${productName}». Transcribe its printed nutrition panel and net weight.`;
}

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
- minutes: duration in minutes (integer-ish). If the user gave REPS or SETS instead of a time, ESTIMATE the minutes it realistically takes, including short rests (e.g. 100 отжиманий за несколько подходов ≈ 8 мин; 3×15 приседаний ≈ 6 мин; планка 3×1 мин ≈ 4 мин; a gym strength set with rest ≈ 3 мин). If a duration is stated, use it. minutes must be > 0.
- sets: for "strength" ONLY — the number of SETS (подходов) when the user stated or clearly implied them ("жим лёжа 4 подхода" → 4; "3×15 приседаний" → 3; "5 подходов приседа и 4 жима" → two entries with 5 and 4). Lifters don't track time, so sets is how the entry will be shown. Omit when not stated and for every non-strength type.
- intensity: for "strength" ONLY — "light" | "moderate" | "heavy", the EFFORT, when the user actually described it. heavy = тяжёлый вес / до отказа / на максимум / «тяжёлая тренировка»; light = лёгкая / разминочная / с малым весом / многоповторка на технику; moderate = «средняя», «рабочий вес», «обычная». OMIT it whenever effort was not described — a plain "силовая 40 минут" has no effort signal, and guessing one would inflate the estimate. Never derive effort from the exercise name alone (приседания ≠ heavy).
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

/**
 * System prompt for parsing a SCREENSHOT of a fitness tracker / sports watch
 * app (Apple Watch, Garmin, Mi Fit, Strava…). Two jobs: (1) read the numbers
 * the tracker itself printed — total active calories and duration — verbatim;
 * (2) map the visible activities to the same structured entries as the text
 * parser. The device's kcal, when present, WINS on the client («по трекеру» —
 * the device measured it with heart rate, we don't out-guess it), so
 * transcription honesty matters more than estimation here.
 */
export const PARSE_WORKOUT_PHOTO_SYSTEM_PROMPT = `You read a SCREENSHOT from a fitness tracker / sports-watch / workout app and turn it into structured entries for a fitness app.

Two tasks:
1. TRANSCRIBE the tracker's own totals when they are visibly printed:
   - device_kcal: the total ACTIVE/workout calories shown on the screen (kcal). Transcribe the printed number exactly — do NOT estimate, do NOT confuse it with steps, distance, heart rate or total daily calories. Omit if no calorie figure is visible.
   - device_minutes: the total workout duration shown, in minutes ("47:32" → 48). Omit if not visible.
2. PARSE the visible activities into the workouts array, exactly like a text description:
   - type: walk, run, cycle, swim, strength, hiit, elliptical, row, sport, dance, martial, yoga — or "other" only when none fits.
   - name_ru: a short Russian label of the activity as shown (e.g. "силовая тренировка", "бег 5 км").
   - minutes: the activity's duration from the screen; if only distance/reps are shown, estimate realistically. Must be > 0.
   - sets: for "strength" ONLY, when the screen shows a set count.
   - intensity: omit — a tracker screen shows numbers, not how hard the set felt. Never infer it.
   - speed_kmh: for walk/run/cycle when pace/speed is shown ("5'30\\"/km" → ~10.9). Omit otherwise.
   - met: ONLY for "other".
   - confidence: 0..1 — how sure you are of the reading (blurry screenshot → lower).

Rules:
- This is NOT a food photo. If the image is not a workout/tracker screen at all, return an empty workouts array and no device numbers.
- Never invent an activity or a number that is not on the screen.`;

export function userWorkoutPhotoInstruction(): string {
  return `Read the workout screenshot: transcribe the tracker's printed calorie/duration totals if visible, and parse the activities. Do not estimate calories yourself.`;
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
          sets: { type: ['number', 'null'], description: 'Set count — ONLY for type "strength" when stated/implied. Omit otherwise.' },
          intensity: {
            type: ['string', 'null'],
            enum: [...STRENGTH_INTENSITY_KEYS, null],
            description:
              'Effort — ONLY for type "strength", and ONLY when the effort was actually described. Omit when it was not: guessing inflates the burn.',
          },
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

/**
 * JSON Schema for the workout-screenshot parse: the same activities array plus
 * the tracker's own printed totals (transcribed, never estimated).
 */
export const PARSE_WORKOUT_PHOTO_SCHEMA = {
  type: 'object',
  properties: {
    workouts: PARSE_WORKOUT_SCHEMA.properties.workouts,
    device_kcal: {
      type: ['number', 'null'],
      description: 'Total active calories PRINTED on the screen, transcribed verbatim. Omit when not visible.',
    },
    device_minutes: {
      type: ['number', 'null'],
      description: 'Total workout duration printed on the screen, in minutes. Omit when not visible.',
    },
  },
  required: ['workouts'],
} as const;
