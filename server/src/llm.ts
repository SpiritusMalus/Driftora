import { TIMEOUT_MS } from './httpTimeout.js';
import { metrics } from './metrics.js';
import {
  ESTIMATE_SEARCH_SCHEMA,
  ESTIMATE_SEARCH_SYSTEM_PROMPT,
  TRANSLATE_LABELS_SCHEMA,
  TRANSLATE_LABELS_SYSTEM_PROMPT,
  userTranslateLabelsInstruction,
  IDENTIFY_PHOTO_SCHEMA,
  IDENTIFY_PHOTO_SYSTEM_PROMPT,
  IDENTIFY_SCHEMA,
  IDENTIFY_SYSTEM_PROMPT,
  PARSE_WORKOUT_PHOTO_SCHEMA,
  PARSE_WORKOUT_PHOTO_SYSTEM_PROMPT,
  PARSE_WORKOUT_SCHEMA,
  PARSE_WORKOUT_SYSTEM_PROMPT,
  userAudioInstruction,
  userEstimateSearchInstruction,
  userInstruction,
  userPhotoInstruction,
  userWorkoutInstruction,
  userWorkoutPhotoInstruction,
} from './prompt.js';
import {
  normalizeIdentified,
  normalizeParsedWorkouts,
  normalizeParsedWorkoutPhoto,
  round1,
  type IdentifiedItem,
  type ParsedWorkout,
  type ParsedWorkoutPhoto,
  type Region,
} from './types.js';

/**
 * LLM identification client (provider migration 2026-06-25).
 *
 * Talks the OpenAI Chat-Completions wire format and points the base URL at
 * OpenRouter (`openrouter.ai/api/v1`), which routes to the configured model
 * (default a Gemini Flash). OpenRouter is reachable from EEA hosts, so it
 * replaces the direct `generativelanguage.googleapis.com` call that the NL VPS
 * was geo-blocked from. Pattern mirrors relo_dojo `backend/app/services/llm.py`
 * (the `openai` branch): pure payload builder + response parser, one error type.
 */
const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-3.5-flash';
/** Optional stronger model for low-confidence escalation (§8.4). Off if unset. */
const PRO_MODEL = process.env.OPENROUTER_PRO_MODEL || '';
/**
 * Output cap. The identification JSON itself is tiny (a short item list), but on
 * a REASONING model the budget is spent on hidden reasoning tokens FIRST and the
 * JSON only starts afterwards — `google/gemini-3.5-flash` burns 1000–2500 of them
 * on a photo. At the old 1024 the budget was exhausted mid-reasoning, so every
 * photo came back truncated (`finish_reason: 'length'`), failed `JSON.parse`, and
 * surfaced as a silent "не распознал". Reasoning cannot be disabled on this
 * endpoint ("Reasoning is mandatory for this endpoint and cannot be disabled"),
 * so the ceiling has to clear reasoning + payload with room to spare.
 */
const MAX_TOKENS = 6144;
/** Sampling for the truncation retry — a different path out of a decode loop. */
const RETRY_TEMPERATURE = 0.3;
const CONFIDENCE_FLOOR = 0.5;

/** Raised when the model is unreachable/failing — routes map it to 503. */
export class VisionUnavailableError extends Error {}

/** One OpenAI chat message; user content may be multimodal (text + image + audio). */
type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
/** OpenRouter audio input (base64 + container format, e.g. 'm4a'/'wav'/'mp3'). */
type AudioPart = { type: 'input_audio'; input_audio: { data: string; format: string } };
export type ChatMessage = {
  role: 'system' | 'user';
  content: string | (TextPart | ImagePart | AudioPart)[];
};

/** Max per-item confidence (0 for an empty result) — the escalation signal. */
function topConfidence(items: IdentifiedItem[]): number {
  return items.reduce((max, it) => Math.max(max, it.confidence), 0);
}

/**
 * Build the OpenAI/OpenRouter chat-completions request body (identification
 * only). `strict: false` — the schema carries no `additionalProperties: false`,
 * so loose json_schema adherence is enough; `normalizeIdentified` is defensive.
 */
export function buildPayload(
  messages: ChatMessage[],
  model: string,
  schema: object = IDENTIFY_SCHEMA,
  temperature = 0,
): Record<string, unknown> {
  return {
    model,
    messages,
    temperature,
    max_tokens: MAX_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'identification', strict: false, schema },
    },
  };
}

/** Some models wrap structured output in ```json fences — strip before parsing. */
function stripFences(text: string): string {
  const m = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1]! : text;
}

/** Parse `choices[0].message.content` (a JSON string) → `IdentifiedItem[]`. */
export function parseResponse(data: unknown): IdentifiedItem[] {
  const d = data as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = d?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(stripFences(text));
  } catch {
    return []; // malformed structured output → unrecognized, never a crash
  }
  return normalizeIdentified(payload);
}

/** POST one chat-completions request and return the raw parsed JSON (or throw). */
async function complete(
  messages: ChatMessage[],
  model: string,
  schema: object,
  temperature = 0,
): Promise<unknown> {
  const key = process.env.OPENROUTER_API_KEY || '';
  if (!key) {
    throw new VisionUnavailableError('OPENROUTER_API_KEY is not configured');
  }
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-Title': 'Driftora', // OpenRouter dashboard attribution (optional, harmless)
      },
      body: JSON.stringify(buildPayload(messages, model, schema, temperature)),
      // A hung OpenRouter call must not hold a /food/parse* request (or an
      // escalation retry) open indefinitely — same treatment as a network error.
      signal: AbortSignal.timeout(TIMEOUT_MS.openrouter),
    });
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named 'AbortError' —
    // treated the same as any other unreachable-upstream failure.
    throw new VisionUnavailableError(err instanceof Error ? err.message : 'OpenRouter request failed');
  }
  if (!res.ok) {
    throw new VisionUnavailableError(`OpenRouter returned ${res.status}`);
  }
  // The body is read AFTER fetch() resolved on headers, so the timeout can fire
  // HERE — and a swallowed abort (`.catch(() => null)`) used to look exactly
  // like a model that found no food: null → parseResponse → [] → «не распознал»
  // with an HTTP 200, at a telltale flat 20.1 s. A body we cannot read is a
  // transport failure, never an answer.
  try {
    return (await res.json()) as unknown;
  } catch (err) {
    throw new VisionUnavailableError(
      err instanceof Error ? `OpenRouter body unreadable: ${err.message}` : 'OpenRouter body unreadable',
    );
  }
}

/** `choices[0].finish_reason`, when the provider reported one. */
export function finishReasonOf(data: unknown): string | undefined {
  const d = data as { choices?: { finish_reason?: unknown }[] } | null;
  const reason = d?.choices?.[0]?.finish_reason;
  return typeof reason === 'string' ? reason : undefined;
}

/**
 * An upstream failure dressed up as a normal choice: OpenRouter reports a
 * provider error (rate limit, provider outage) as `finish_reason: 'error'` with
 * a null content and HTTP 200 — so it slips past the `res.ok` check, parses to
 * an empty item list, and reaches the user as «не распознал». Observed shape:
 * `{"finish_reason":"error","error":{"code":429,...},"message":{"content":null}}`.
 *
 * Retrying would just hammer whatever is already refusing us, so this surfaces
 * as VisionUnavailableError (→ 503) instead: an honest "try again in a moment".
 */
export function providerErrorOf(data: unknown): string | undefined {
  const d = data as { choices?: { error?: { code?: unknown; message?: unknown } }[] } | null;
  const err = d?.choices?.[0]?.error;
  if (!err) return finishReasonOf(data) === 'error' ? 'provider error' : undefined;
  const code = typeof err.code === 'number' || typeof err.code === 'string' ? String(err.code) : '?';
  return `provider error ${code}`;
}

/**
 * `complete`, plus ONE retry when the model ran out of budget mid-answer.
 *
 * Truncation here is rarely "the answer was too long" — it is the model falling
 * into a degenerate decode loop (observed tails: `312312312…`, `000000000…`,
 * `29.0e0000…`) and spending the whole ceiling on repeated digits. Greedy
 * sampling cannot escape such a loop, so the retry re-rolls at a non-zero
 * temperature to take a different path.
 *
 * Returns the response AND whether it is still truncated, so identification can
 * fail loudly while best-effort callers (estimate, translate) keep degrading
 * gracefully on whatever came back.
 */
async function completeWithRetry(
  messages: ChatMessage[],
  model: string,
  schema: object,
): Promise<{ data: unknown; truncated: boolean }> {
  const first = await complete(messages, model, schema);
  // A provider error rides in on HTTP 200 — fail now rather than retry into a
  // rate limit that is already refusing us.
  const failed = providerErrorOf(first);
  if (failed) throw new VisionUnavailableError(failed);
  if (finishReasonOf(first) !== 'length') return { data: first, truncated: false };

  metrics.recordTruncationRetry();
  const second = await complete(messages, model, schema, RETRY_TEMPERATURE);
  const failedAgain = providerErrorOf(second);
  if (failedAgain) throw new VisionUnavailableError(failedAgain);
  return { data: second, truncated: finishReasonOf(second) === 'length' };
}

async function callModel(messages: ChatMessage[], model: string, schema: object = IDENTIFY_SCHEMA): Promise<IdentifiedItem[]> {
  const { data, truncated } = await completeWithRetry(messages, model, schema);
  const items = parseResponse(data);
  // A truncated answer that yielded nothing is a SERVER failure, not an honest
  // "no food here" — returning [] would render as «не распознал» and hide the
  // breakage (exactly how the 1024-token ceiling went unnoticed for weeks).
  if (items.length === 0 && truncated) {
    throw new VisionUnavailableError('model response truncated (max_tokens) after retry');
  }
  return items;
}

/**
 * Run identification on the default (fast) model, then OPTIONALLY escalate to a
 * stronger model when the result is empty or below the confidence floor — but
 * only if `OPENROUTER_PRO_MODEL` is configured (§8.4). The stronger result is
 * kept only when it actually improves (more items or higher top confidence).
 */
async function identifyWithEscalation(messages: ChatMessage[], schema: object = IDENTIFY_SCHEMA): Promise<IdentifiedItem[]> {
  const base = await callModel(messages, MODEL, schema);
  if (!PRO_MODEL) return base;

  const weak = base.length === 0 || topConfidence(base) < CONFIDENCE_FLOOR;
  if (!weak) return base;

  let escalated: IdentifiedItem[];
  try {
    escalated = await callModel(messages, PRO_MODEL, schema);
  } catch {
    return base; // escalation is best-effort; keep the fast result on failure
  }
  metrics.recordEscalation();
  const better =
    escalated.length > base.length ||
    (escalated.length > 0 && topConfidence(escalated) > topConfidence(base));
  return better ? escalated : base;
}

/** One AI per-100g estimate for a typed food name (manual search), all fields present. */
export interface FoodEstimate {
  name: string;
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
}

/**
 * Manual-search AI estimate: the user typed a food name and we ALWAYS return a
 * per-100g guess (brand- and intent-aware) shown next to the DB rows, flagged
 * «≈ оценка ИИ». This is the sanctioned, attributed AI-estimate path — not
 * laundered DB data — so it never refuses. Returns null only on a malformed /
 * failed model response (the caller just omits the AI row).
 */
export async function estimateFoodPer100(name: string, region: Region): Promise<FoodEstimate | null> {
  // Best-effort: a still-truncated retry just parses to null and the caller
  // omits the AI row — never a 503 for the whole search.
  const { data } = await completeWithRetry(
    [
      { role: 'system', content: ESTIMATE_SEARCH_SYSTEM_PROMPT },
      { role: 'user', content: userEstimateSearchInstruction(region, name) },
    ],
    MODEL,
    ESTIMATE_SEARCH_SCHEMA,
  );
  return parseEstimate(data, name);
}

/** Parse the estimate model's `choices[0].message.content` → FoodEstimate | null. */
function parseEstimate(data: unknown, fallbackName: string): FoodEstimate | null {
  const d = data as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = d?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(stripFences(text));
  } catch {
    return null;
  }
  const o = payload as Record<string, unknown>;
  // Mirror `coerceEstimate`'s bounds (types.ts): the identify path clamps its
  // AI numbers there, and this manual-search card must not stay the one hole a
  // model glitch (or an injected «kcal_100g=9999999») pushes absurd numbers
  // through — nothing edible exceeds ~900 kcal / 100 g of any macro over 100 g.
  const num = (v: unknown, max: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : undefined;
  const kcal = num(o.kcal_100g, 900);
  const prot = num(o.prot_100g, 100);
  const fat = num(o.fat_100g, 100);
  const carb = num(o.carb_100g, 100);
  // An estimate is only useful complete — a partial guess reads as fabricated fact.
  if (kcal === undefined || prot === undefined || fat === undefined || carb === undefined) return null;
  // All zeros would render an authoritative-looking «0 kcal» card for any food.
  if (kcal === 0 && prot === 0 && fat === 0 && carb === 0) return null;
  const name = typeof o.name_ru === 'string' && o.name_ru.trim().length > 0 ? o.name_ru.trim() : fallbackName;
  return { name, kcal: Math.round(kcal), prot: round1(prot), fat: round1(fat), carb: round1(carb) };
}

/**
 * DISPLAY-ONLY: batch-translate short English DB labels (FatSecret/USDA row
 * names) into short Russian names. Returns an array aligned 1:1 to `labels`
 * (same order/length). Best-effort — on any failure or a shape mismatch it
 * returns the inputs UNCHANGED, so the caller safely falls back to English.
 * Never touches nutrition numbers; the source tag stays truthful.
 */
export async function translateFoodLabels(labels: string[]): Promise<string[]> {
  if (labels.length === 0) return [];
  let raw: unknown;
  try {
    ({ data: raw } = await completeWithRetry(
      [
        { role: 'system', content: TRANSLATE_LABELS_SYSTEM_PROMPT },
        { role: 'user', content: userTranslateLabelsInstruction(labels) },
      ],
      MODEL,
      TRANSLATE_LABELS_SCHEMA,
    ));
  } catch {
    return labels; // upstream failure → keep English, never throw into a parse
  }
  return parseTranslations(raw, labels);
}

/** Parse the translate model's content → string[] aligned to `labels`. On any
 *  malformed / wrong-length output, returns `labels` (English) unchanged. */
export function parseTranslations(data: unknown, labels: string[]): string[] {
  const d = data as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = d?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return labels;
  let payload: unknown;
  try {
    payload = JSON.parse(stripFences(text));
  } catch {
    return labels;
  }
  const arr = (payload as { translations?: unknown }).translations;
  // A length mismatch means the model dropped/merged entries — we can't align
  // them safely, so fall back wholesale rather than mislabel a food.
  if (!Array.isArray(arr) || arr.length !== labels.length) return labels;
  return labels.map((original, i) => {
    const t = arr[i];
    return typeof t === 'string' && t.trim().length > 0 ? t.trim() : original;
  });
}

/** Layer 2: free-text meal → identified foods + estimated grams (no numbers). */
export async function identifyFromText(text: string, region: Region): Promise<IdentifiedItem[]> {
  return identifyWithEscalation([
    { role: 'system', content: IDENTIFY_SYSTEM_PROMPT },
    { role: 'user', content: `${userInstruction(region)}\n\n${text}` },
  ]);
}

/** Layer 1: photo (base64) → identified foods + estimated grams (Phase 3). */
export async function identifyFromPhoto(
  base64: string,
  mimeType: string,
  region: Region,
): Promise<IdentifiedItem[]> {
  return identifyWithEscalation(
    [
      { role: 'system', content: IDENTIFY_PHOTO_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPhotoInstruction(region) },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
    IDENTIFY_PHOTO_SCHEMA,
  );
}

/**
 * Voice meal → identified foods + estimated grams. The audio (base64, e.g. m4a)
 * goes to the same multimodal model as text/photo via OpenRouter's `input_audio`
 * content part; the model understands the speech and returns the SAME identify
 * schema. Numbers still come from the DB (§4 honesty rule).
 */
export async function identifyFromAudio(
  base64: string,
  format: string,
  region: Region,
): Promise<IdentifiedItem[]> {
  return identifyWithEscalation([
    { role: 'system', content: IDENTIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: userAudioInstruction(region) },
        { type: 'input_audio', input_audio: { data: base64, format } },
      ],
    },
  ]);
}

/** `choices[0].message.content` → parsed JSON payload, or null on any malformation. */
function completionPayload(data: unknown): unknown {
  const d = data as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = d?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string' ? content.trim() : '';
  if (!raw) return null;
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return null; // malformed structured output → nothing parsed, never a crash
  }
}

/**
 * Parse a free-text workout description → structured activities. No escalation
 * (parsing "100 отжиманий" is easy for the fast model) and no region (activity
 * is universal). kcal is computed client-side, so nothing energy-related is
 * returned — the model only maps text → type/minutes/pace (+ a MET for 'other').
 */
export async function parseWorkoutFromText(text: string): Promise<ParsedWorkout[]> {
  const { data } = await completeWithRetry(
    [
      { role: 'system', content: PARSE_WORKOUT_SYSTEM_PROMPT },
      { role: 'user', content: `${userWorkoutInstruction()}\n\n${text}` },
    ],
    MODEL,
    PARSE_WORKOUT_SCHEMA,
  );
  return normalizeParsedWorkouts(completionPayload(data));
}

/**
 * Spoken workout description → the same structured activities as the text
 * parser: the clip rides in as an `input_audio` part, everything else —
 * prompt, schema, honesty split (kcal stays client-side) — is identical.
 */
export async function parseWorkoutFromAudio(base64: string, format: string): Promise<ParsedWorkout[]> {
  const { data } = await completeWithRetry(
    [
      { role: 'system', content: PARSE_WORKOUT_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userWorkoutInstruction() },
          { type: 'input_audio', input_audio: { data: base64, format } },
        ],
      },
    ],
    MODEL,
    PARSE_WORKOUT_SCHEMA,
  );
  return normalizeParsedWorkouts(completionPayload(data));
}

/**
 * Fitness-tracker screenshot → activities + the tracker's OWN printed totals
 * (device_kcal / device_minutes, transcribed — never estimated). When the
 * device names a burn the client logs that number, so this path may return
 * energy values, unlike every other workout parse: they are the tracker's
 * measurements passing through, not model arithmetic.
 */
export async function parseWorkoutFromPhoto(base64: string, mimeType: string): Promise<ParsedWorkoutPhoto> {
  const { data } = await completeWithRetry(
    [
      { role: 'system', content: PARSE_WORKOUT_PHOTO_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: userWorkoutPhotoInstruction() },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ],
      },
    ],
    MODEL,
    PARSE_WORKOUT_PHOTO_SCHEMA,
  );
  return normalizeParsedWorkoutPhoto(completionPayload(data));
}
