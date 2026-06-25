import { stubIdentifyFromPhoto, stubIdentifyFromText } from './identifyStub.js';
import { metrics } from './metrics.js';
import { IDENTIFY_SCHEMA, IDENTIFY_SYSTEM_PROMPT, userInstruction } from './prompt.js';
import { normalizeIdentified, type IdentifiedItem, type Region } from './types.js';

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
/** Identification output is tiny (a short item list) — cap defensively. */
const MAX_TOKENS = 1024;
const CONFIDENCE_FLOOR = 0.5;

/**
 * TEMPORARY: when `LLM_STUB=1`, identification is served by a local stub instead
 * of the live model (used while no OpenRouter key is provisioned). Numbers still
 * come from the resolver. Remove with `identifyStub.ts` once a key is verified.
 */
const STUB = process.env.LLM_STUB === '1';

/** Raised when the model is unreachable/failing — routes map it to 503. */
export class VisionUnavailableError extends Error {}

/** One OpenAI chat message; user content may be multimodal (text + image). */
type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
export type ChatMessage = { role: 'system' | 'user'; content: string | (TextPart | ImagePart)[] };

/** Max per-item confidence (0 for an empty result) — the escalation signal. */
function topConfidence(items: IdentifiedItem[]): number {
  return items.reduce((max, it) => Math.max(max, it.confidence), 0);
}

/**
 * Build the OpenAI/OpenRouter chat-completions request body (identification
 * only). `strict: false` — the schema carries no `additionalProperties: false`,
 * so loose json_schema adherence is enough; `normalizeIdentified` is defensive.
 */
export function buildPayload(messages: ChatMessage[], model: string): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: 0,
    max_tokens: MAX_TOKENS,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'identification', strict: false, schema: IDENTIFY_SCHEMA },
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

async function callModel(messages: ChatMessage[], model: string): Promise<IdentifiedItem[]> {
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
      body: JSON.stringify(buildPayload(messages, model)),
    });
  } catch (err) {
    throw new VisionUnavailableError(err instanceof Error ? err.message : 'OpenRouter request failed');
  }
  if (!res.ok) {
    throw new VisionUnavailableError(`OpenRouter returned ${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as unknown;
  return parseResponse(data);
}

/**
 * Run identification on the default (fast) model, then OPTIONALLY escalate to a
 * stronger model when the result is empty or below the confidence floor — but
 * only if `OPENROUTER_PRO_MODEL` is configured (§8.4). The stronger result is
 * kept only when it actually improves (more items or higher top confidence).
 */
async function identifyWithEscalation(messages: ChatMessage[]): Promise<IdentifiedItem[]> {
  const base = await callModel(messages, MODEL);
  if (!PRO_MODEL) return base;

  const weak = base.length === 0 || topConfidence(base) < CONFIDENCE_FLOOR;
  if (!weak) return base;

  let escalated: IdentifiedItem[];
  try {
    escalated = await callModel(messages, PRO_MODEL);
  } catch {
    return base; // escalation is best-effort; keep the fast result on failure
  }
  metrics.recordEscalation();
  const better =
    escalated.length > base.length ||
    (escalated.length > 0 && topConfidence(escalated) > topConfidence(base));
  return better ? escalated : base;
}

/** Layer 2: free-text meal → identified foods + estimated grams (no numbers). */
export async function identifyFromText(text: string, region: Region): Promise<IdentifiedItem[]> {
  if (STUB) return stubIdentifyFromText(text); // TEMPORARY — see identifyStub.ts
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
  if (STUB) return stubIdentifyFromPhoto(); // TEMPORARY — see identifyStub.ts
  return identifyWithEscalation([
    { role: 'system', content: IDENTIFY_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: userInstruction(region) },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
      ],
    },
  ]);
}
