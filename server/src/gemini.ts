import { IDENTIFY_SCHEMA, IDENTIFY_SYSTEM_PROMPT, userInstruction } from './prompt.js';
import { normalizeIdentified, type IdentifiedItem, type Region } from './types.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash';

/** Raised when Gemini is unreachable/failing — routes map it to 503. */
export class VisionUnavailableError extends Error {}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function endpoint(): string {
  const key = process.env.GEMINI_API_KEY || '';
  return `${API_BASE}/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
}

async function callGemini(parts: GeminiPart[]): Promise<IdentifiedItem[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new VisionUnavailableError('GEMINI_API_KEY is not configured');
  }
  let res: Response;
  try {
    res = await fetch(endpoint(), {
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

/** Layer 2: free-text meal → identified foods + estimated grams (no numbers). */
export async function identifyFromText(text: string, region: Region): Promise<IdentifiedItem[]> {
  return callGemini([{ text: `${userInstruction(region)}\n\n${text}` }]);
}

/** Layer 1: photo (base64) → identified foods + estimated grams (Phase 3). */
export async function identifyFromPhoto(
  base64: string,
  mimeType: string,
  region: Region,
): Promise<IdentifiedItem[]> {
  return callGemini([
    { text: userInstruction(region) },
    { inlineData: { mimeType, data: base64 } },
  ]);
}
