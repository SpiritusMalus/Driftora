import type { FoodParseResult, FoodParser, ParseConfidence, ParsedFoodItem } from './foodParser';

const CONFIDENCES: readonly ParseConfidence[] = ['high', 'medium', 'low'];
const DEFAULT_TIMEOUT_MS = 10_000;

function isItem(value: unknown): value is ParsedFoodItem {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    (typeof v.qtyG === 'number' || v.qtyG === null) &&
    typeof v.kcal === 'number' &&
    typeof v.proteinG === 'number' &&
    typeof v.fatG === 'number' &&
    typeof v.carbG === 'number' &&
    typeof v.assumptions === 'string'
  );
}

/** Structural guard: the backend may be down, stale, or misbehaving. */
function isResult(value: unknown): value is FoodParseResult {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.items) &&
    v.items.every(isItem) &&
    typeof v.kcal === 'number' &&
    typeof v.proteinG === 'number' &&
    typeof v.fatG === 'number' &&
    typeof v.carbG === 'number' &&
    CONFIDENCES.includes(v.confidence as ParseConfidence) &&
    typeof v.needsClarification === 'boolean' &&
    (typeof v.clarifyQuestion === 'string' || v.clarifyQuestion === null)
  );
}

/**
 * Online food parser — POSTs the utterance to the food-parse backend (the app's
 * ONLY external network call) and returns a `FoodParseResult`.
 *
 * On any failure — network error, timeout (~10s), non-2xx, or a response that
 * doesn't match the contract — it silently falls back to the offline parser so
 * the food-log screen never breaks (handoff §6). `source` ('voice'/'text') is
 * the client's concern and is not sent to the backend.
 */
export class HttpFoodParser implements FoodParser {
  constructor(
    private readonly endpoint: string,
    private readonly fallback: FoodParser,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async parse(utterance: string): Promise<FoodParseResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utterance, locale: 'ru' }),
        signal: controller.signal,
      });
      if (!res.ok) return this.fallback.parse(utterance);
      const data: unknown = await res.json();
      if (!isResult(data)) return this.fallback.parse(utterance);
      return data;
    } catch {
      // Network error or timeout — stay usable offline.
      return this.fallback.parse(utterance);
    } finally {
      clearTimeout(timer);
    }
  }
}
