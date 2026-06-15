import type { FoodParser } from './foodParser';
import { StubFoodParser } from './stubFoodParser';

let _parser: FoodParser | null = null;

/**
 * Returns the active food parser.
 *
 * For now this is the offline [StubFoodParser] (live LLM calls are disabled).
 * When the real parser lands, construct an `AnthropicFoodParser` here when an
 * API key is configured and fall back to the stub otherwise — callers don't
 * change.
 */
export function getFoodParser(): FoodParser {
  _parser ??= new StubFoodParser();
  return _parser;
}
