import { metrics } from './metrics.js';
import { IDENTIFY_SCHEMA, IDENTIFY_SYSTEM_PROMPT, userInstruction } from './prompt.js';
import { normalizeIdentified, type IdentifiedItem, type Region } from './types.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash';
/** Optional stronger model for low-confidence escalation (§8.4). Off if unset. */
const PRO_MODEL = process.env.GEMINI_PRO_MODEL || '';
const CONFIDENCE_FLOOR = 0.5;

/** Raised when Gemini is unreachable/failing — routes map it to 503. */
export class VisionUnavailableError extends Error {}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function endpoint(model: string): string {
  const key = process.env.GEMINI_API_KEY || '';
  return `${API_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;
}

/** Max per-item confidence (0 for an empty result) — the escalation signal. */
function topConfidence(items: IdentifiedItem[]): number {
  return items.reduce((max, it) => Math.max(max, it.confidence), 0);
}

async function callGemini(parts: GeminiPart[], model: string): Promise<IdentifiedItem[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new VisionUnavailableError('GEMINI_API_KEY is not configured');
  }
  let res: Response;
  try {
    res = await fetch(endpoint(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: IDENTIFY_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: IDENTIFY_SCHEMA,
        },
      }),
    });
  } catch (err) {
    throw new VisionUnavailableError(err instanceof Error ? err.message : 'Gemini request failed');
  }
  if (!res.ok) {
    throw new VisionUnavailableError(`Gemini returned ${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as
    | { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    | null;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return []; // malformed structured output → unrecognized, never a crash
  }
  return normalizeIdentified(payload);
}

/**
 * Run identification on the default (fast) model, then OPTIONALLY escalate to a
 * stronger model when the result is empty or below the confidence floor — but
 * only if `GEMINI_PRO_MODEL` is configured (§8.4). The stronger result is kept
 * only when it actually improves (more items or higher top confidence).
 */
async function identifyWithEscalation(parts: GeminiPart[]): Promise<IdentifiedItem[]> {
  const base = await callGemini(parts, MODEL);
  if (!PRO_MODEL) return base;

  const weak = base.length === 0 || topConfidence(base) < CONFIDENCE_FLOOR;
  if (!weak) return base;

  let escalated: IdentifiedItem[];
  try {
    escalated = await callGemini(parts, PRO_MODEL);
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
  return identifyWithEscalation([{ text: `${userInstruction(region)}\n\n${text}` }]);
}

/** Layer 1: photo (base64) → identified foods + estimated grams (Phase 3). */
export async function identifyFromPhoto(
  base64: string,
  mimeType: string,
  region: Region,
): Promise<IdentifiedItem[]> {
  return identifyWithEscalation([
    { text: userInstruction(region) },
    { inlineData: { mimeType, data: base64 } },
  ]);
}
