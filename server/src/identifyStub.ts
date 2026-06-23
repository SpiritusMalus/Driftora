/**
 * TEMPORARY identification stub (operator request, 2026-06-21).
 *
 * WHY THIS EXISTS — the free Gemini tier geo-blocks this deploy's VPS egress IP
 * ("400 User location is not supported"), so the real model is unreachable from
 * the server right now. To let the operator run Driftora end-to-end for the
 * off-store test, this stub stands in for the LLM's IDENTIFICATION step only:
 * text/photo → `IdentifiedItem[]` (food name + estimated grams). It emits NO
 * nutrition numbers — every kcal/macro/mineral still comes from the real
 * region resolver (Skurikhin / OpenFoodFacts), so THE HONESTY RULE (§1/§4) holds.
 *
 * HOW TO REMOVE when Gemini becomes reachable (paid Vertex or an unblocked
 * egress) — it's deliberately isolated:
 *   1. unset `GEMINI_STUB` in `server/.env` and `systemctl restart`
 *      (instant rollback — no code change, no rebuild needed); then
 *   2. delete this file + the two `STUB` guards at the top of `gemini.ts`.
 */
import { round1, type IdentifiedItem } from './types.js';

/** Stub-sourced items carry a fixed, honestly-modest confidence. */
const STUB_CONFIDENCE = 0.8;

/** Split a free-text meal into per-food chunks (commas, newlines, " и ", "+"). */
function splitChunks(text: string): string[] {
  return text
    .split(/\s*[,;\n+]\s*|\s+и\s+|\s+с\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Best-effort weight from a chunk. Handles кг/kg, г/гр/грамм/g, мл/ml, л/l.
 * A trailing-letter lookahead keeps "г" in "груша" from reading as grams.
 * Returns undefined when the chunk states no weight (→ resolver default 100 g).
 */
function grams(m: RegExpMatchArray | null, mult = 1): number | undefined {
  if (!m) return undefined;
  return round1(parseFloat((m[1] ?? '0').replace(',', '.')) * mult);
}

function parseGrams(chunk: string): number | undefined {
  return (
    grams(chunk.match(/(\d+(?:[.,]\d+)?)\s*(кг|kg)(?![а-яёa-z])/i), 1000) ??
    grams(chunk.match(/(\d+(?:[.,]\d+)?)\s*(л|l)(?![а-яёa-z])/i), 1000) ??
    grams(chunk.match(/(\d+(?:[.,]\d+)?)\s*(грамм\w*|гр|г|gr|g)(?![а-яёa-z])/i)) ??
    grams(chunk.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml)(?![а-яёa-z])/i))
  );
}

/** Strip quantities/units/filler so what's left is the food name to resolve. */
function cleanName(chunk: string): string {
  return chunk
    .replace(/\d+(?:[.,]\d+)?\s*(кг|kg|грамм\w*|гр|г|gr|g|мл|ml|л|l|шт\w*|штук\w*|порц\w*)(?![а-яёa-z])/gi, ' ')
    .replace(/\b(примерно|около|где-то|немного|чуть|пара|пару)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Layer 2 stand-in: free-text meal → identified foods + estimated grams.
 * Names pass straight to the RU resolver, which supplies the real numbers.
 */
export function stubIdentifyFromText(text: string): IdentifiedItem[] {
  const items: IdentifiedItem[] = [];
  for (const chunk of splitChunks(text)) {
    const name = cleanName(chunk);
    if (name.length === 0) continue;
    const grams = parseGrams(chunk);
    items.push({
      name_ru: name,
      name_en: name,
      est_grams: grams && grams > 0 ? grams : 100,
      confidence: STUB_CONFIDENCE,
    });
  }
  return items;
}

/**
 * Layer 1 stand-in: with no vision model reachable, a photo can't be read, so
 * return a fixed, plausible plate whose names resolve in the RU table. This is a
 * placeholder so the photo flow is exercisable end-to-end — it does NOT reflect
 * the actual photo. Removed together with the text stub when Gemini returns.
 */
export function stubIdentifyFromPhoto(): IdentifiedItem[] {
  return [
    { name_ru: 'куриная грудка', name_en: 'chicken breast', est_grams: 150, confidence: STUB_CONFIDENCE },
    { name_ru: 'рис', name_en: 'rice', est_grams: 120, confidence: STUB_CONFIDENCE },
    { name_ru: 'брокколи', name_en: 'broccoli', est_grams: 80, confidence: STUB_CONFIDENCE },
  ];
}
