/**
 * Wire contract — MUST stay byte-for-byte compatible with the app's
 * `lib/core/services/foodParser.ts`. The backend returns exactly this shape.
 */

export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ParsedFoodItem {
  name: string;
  qtyG: number | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  assumptions: string;
}

export interface FoodParseResult {
  items: ParsedFoodItem[];
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  confidence: ParseConfidence;
  needsClarification: boolean;
  clarifyQuestion: string | null;
}

/**
 * What the LLM tool returns — items + meta only. Totals are recomputed
 * server-side from `items` so they always agree (handoff §9).
 */
export interface LlmFoodPayload {
  items: ParsedFoodItem[];
  confidence: ParseConfidence;
  needsClarification: boolean;
  clarifyQuestion: string | null;
}

const CONFIDENCES: readonly ParseConfidence[] = ['high', 'medium', 'low'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function coerceItem(raw: unknown): ParsedFoodItem | null {
  if (raw === null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name).trim();
  if (name.length === 0) return null;
  const qtyRaw = r.qtyG;
  const qtyG =
    qtyRaw === null || qtyRaw === undefined || qtyRaw === ''
      ? null
      : round1(Math.max(0, num(qtyRaw)));
  return {
    name,
    qtyG,
    kcal: Math.max(0, Math.round(num(r.kcal))),
    proteinG: round1(Math.max(0, num(r.proteinG))),
    fatG: round1(Math.max(0, num(r.fatG))),
    carbG: round1(Math.max(0, num(r.carbG))),
    assumptions: str(r.assumptions).trim(),
  };
}

/**
 * Validate + normalize a raw LLM tool payload into a `FoodParseResult`.
 *
 * Pure and total: never throws. Recomputes totals from items, clamps the
 * confidence enum, and enforces the clarify/empty invariants. Garbage in →
 * a valid empty result, never a 500 (handoff §10).
 */
export function normalizeResult(payload: unknown): FoodParseResult {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  const items = Array.isArray(p.items)
    ? p.items.map(coerceItem).filter((it): it is ParsedFoodItem => it !== null)
    : [];

  const confidence: ParseConfidence = CONFIDENCES.includes(p.confidence as ParseConfidence)
    ? (p.confidence as ParseConfidence)
    : 'low';

  const clarifyQuestionRaw = str(p.clarifyQuestion).trim();
  // Clarification only makes sense when the model actually asked something.
  const needsClarification = p.needsClarification === true && clarifyQuestionRaw.length > 0;
  const clarifyQuestion = needsClarification ? clarifyQuestionRaw : null;

  const totals = items.reduce(
    (acc, it) => ({
      kcal: acc.kcal + it.kcal,
      proteinG: acc.proteinG + it.proteinG,
      fatG: acc.fatG + it.fatG,
      carbG: acc.carbG + it.carbG,
    }),
    { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 },
  );

  return {
    items,
    kcal: Math.round(totals.kcal),
    proteinG: round1(totals.proteinG),
    fatG: round1(totals.fatG),
    carbG: round1(totals.carbG),
    confidence,
    needsClarification,
    clarifyQuestion,
  };
}

/** Empty result for unrecognized input — client shows "не удалось распознать". */
export function emptyResult(): FoodParseResult {
  return {
    items: [],
    kcal: 0,
    proteinG: 0,
    fatG: 0,
    carbG: 0,
    confidence: 'low',
    needsClarification: false,
    clarifyQuestion: null,
  };
}
