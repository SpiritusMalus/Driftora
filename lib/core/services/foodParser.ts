/// Confidence of a parse, mirroring the LLM contract.
export type ParseConfidence = 'high' | 'medium' | 'low';

/// One parsed food item with its macros (БЖУ) and the assumptions made.
export interface ParsedFoodItem {
  name: string;
  qtyG: number | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  assumptions: string;
}

/// Structured result of parsing a Russian food utterance into items + totals.
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

/// Turns a free-form Russian food utterance into structured macros.
///
/// Implemented in M1 over the Anthropic Messages API (tool use, low temperature).
/// This is the app's ONLY external network call; nothing else leaves the device.
export interface FoodParser {
  parse(utterance: string): Promise<FoodParseResult>;
}
