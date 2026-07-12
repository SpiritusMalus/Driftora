/**
 * "Variety, not totals" — an anti-ED framing for the food screen (A5). Instead
 * of judging amounts, it gently notes the *variety* of what was logged today
 * (distinct items), which is genuinely good for the body and sidesteps any
 * calorie/limit framing. One short sentence; pure, ru-first, matching
 * `proteinInsight` (the project's insight convention).
 *
 * "Variety" is the count of DISTINCT logged items today — derivable from data
 * the app already stores (`food_items.name`). No fiber/micronutrient data is
 * assumed: fiber is NOT stored (verified), so we never imply it.
 */

export type VarietyBand = 'none' | 'some' | 'varied';

/// Classifies how many distinct items were logged today. `none` is for the
/// empty case — callers render the line only when there is data, so it rarely
/// shows, but it stays gentle and never nags.
export function varietyBand(distinctItems: number): VarietyBand {
  if (distinctItems <= 0) return 'none';
  if (distinctItems <= 2) return 'some';
  return 'varied';
}

/// One warm, body-neutral sentence about today's variety. ED rule: never "eat
/// more / less", never a target, never calories — variety is framed as a kind
/// thing for the body, framed as care for the body, not a number.
export function varietyInsight(distinctItems: number): string {
  switch (varietyBand(distinctItems)) {
    case 'none':
      return 'Разнообразие в еде — мягкая забота о теле. Впереди целый день.';
    case 'some':
      return 'Уже есть из чего собрать день. Разные продукты — сами по себе забота о теле.';
    case 'varied':
      return 'Сегодня в рационе несколько разных продуктов — хорошая опора для организма.';
  }
}
