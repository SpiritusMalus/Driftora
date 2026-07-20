/**
 * Local kcal plausibility bands by broad food class — the zero-latency referee.
 *
 * The LLM referee only inspects rows that are already under suspicion (weak
 * match, unhonored grade), so a CONFIDENT match carrying absurd numbers sails
 * straight through: the tester's «кабачки» resolved to a 306 kcal/100 g USDA row
 * (some breaded-and-fried variant) with decent name coverage, and nothing was
 * left to object. A static band table catches that class of error without a
 * model call and without a millisecond of latency.
 *
 * Design rules, in order of importance:
 * - NO false positives. Every band is deliberately wide — it should fire on
 *   «vegetable at 306» and stay silent on every legitimate preparation. When a
 *   word is ambiguous («салат» the leaf vs «салат» the mayonnaise-rich dish,
 *   potatoes that fry up to 300, avocado among fruit) the word is simply NOT
 *   in the table. A band that cries wolf is worse than no band.
 * - First match wins, dish-level patterns before ingredient-level ones:
 *   «куриный суп» must hit the soup band, never a poultry band (which is why
 *   there deliberately is no meat band at all — сало, шкварки and fried skin
 *   make any meat range a lie).
 * - Bands judge kcal only. Macro-level nonsense is the LLM referee's job; this
 *   table exists to catch the one error class a name match cannot see.
 */
type Band = { pattern: RegExp; min: number; max: number };

const BANDS: readonly Band[] = [
  // Dish-level first: watery first courses. Solyanka with sour cream ~90;
  // nothing ladled from a pot legitimately reaches 200/100 g.
  { pattern: /\bсуп|бульон|борщ|щи\b|солянк|окрошк|soup|broth|bouillon/, min: 5, max: 200 },
  // Watery vegetables (NOT potatoes, not «салат», not legumes — all excluded on
  // purpose: they legitimately leave this range when fried/oiled/dried).
  {
    pattern: /кабач|zucchini|огурц|огурец|cucumber|помидор|томат|tomato|капуст|cabbage|брокколи|broccoli|цветная капуста|cauliflower|шпинат|spinach|редис|radish|тыкв|pumpkin|баклажан|eggplant/,
    min: 5,
    max: 160,
  },
  // Common fruit & berries (avocado deliberately absent — 160+ is normal there;
  // dried fruit excluded by the «сушен/вялен/dried» guard below).
  {
    pattern: /яблок|apple|груш|pear\b|банан|banana|апельсин|orange\b|мандарин|tangerine|виноград|grape|клубник|strawberr|малин|raspberr|черешн|вишн|cherr|арбуз|watermelon|дын|melon|персик|peach|слив[аы]|plum|ягод|berr/,
    min: 15,
    max: 170,
  },
  // Chocolate in any form — bars, filled bars, candies. The observed failure:
  // a 329 kcal generic row for a ~490 kcal filled dark bar; real chocolate
  // products live in 350–650.
  { pattern: /шокол|chocolate|конфет|candy bar/, min: 350, max: 650 },
  // Butters and oils — nothing sold as «масло» is under ~500.
  { pattern: /масло|butter|\boil\b/, min: 500, max: 930 },
  // Drinking dairy (NOT сливки, творог, сыр — they legitimately range wider).
  { pattern: /молоко|\bmilk\b|кефир|kefir|ряженк|простокваш/, min: 20, max: 130 },
];

/** Dried/cured forms leave every fresh-food band — never judge them by it. */
const DRIED = /сушен|вялен|суш[её]н|dried|dehydrated|jerky/;

/**
 * True when the matched row's kcal is impossible for the food's CLASS — the
 * signal to treat the row like a weak match (estimate primary, row demoted to
 * an alternative). Judged on the USER-side name (what the food IS), never the
 * row's own name (which is exactly what's under suspicion).
 */
export function kcalBandViolated(nameRu: string, nameEn: string, kcal: number): boolean {
  const hay = `${nameRu} ${nameEn}`.toLowerCase();
  if (DRIED.test(hay)) return false;
  for (const band of BANDS) {
    if (band.pattern.test(hay)) return kcal < band.min || kcal > band.max;
  }
  return false;
}
