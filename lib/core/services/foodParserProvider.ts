import type { FoodParser } from './foodParser';
import { HttpFoodParser } from './httpFoodParser';
import { StubFoodParser } from './stubFoodParser';

let _parser: FoodParser | null = null;

/**
 * Returns the active food parser.
 *
 * When `EXPO_PUBLIC_FOOD_API_URL` is set, the online [HttpFoodParser] calls the
 * food-parse backend (with the offline [StubFoodParser] as its failure
 * fallback). With no URL configured, the app runs fully offline on the stub —
 * so the food-log flow always works. Callers don't change.
 */
export function getFoodParser(): FoodParser {
  if (_parser) return _parser;
  const base = process.env.EXPO_PUBLIC_FOOD_API_URL;
  const stub = new StubFoodParser();
  _parser = base ? new HttpFoodParser(base, stub) : stub;
  return _parser;
}
