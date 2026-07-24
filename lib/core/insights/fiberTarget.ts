/**
 * Daily dietary-fiber target (клетчатка / пищевые волокна), scaled to the user's
 * calorie budget instead of a flat number — the shape the science itself uses
 * (docs/nutrition-science.md §5/§9):
 *   • IOM/NASEM Adequate Intake: 14 g per 1000 kcal (→ ~25 g women / 38 g men)
 *   • Russia, МР 2.3.1.0253-21: 20–25 g/day, or 10 g per 1000 kcal
 *   • EFSA / WHO: 25 g/day for adults
 *
 * We take the midpoint 12 g per 1000 kcal and FLOOR at 25 g, the EFSA/WHO adult
 * minimum, so an aggressive deficit never sets an unreasonably low goal:
 *
 *   target = max(25, round(budgetKcal / 1000 × 12))
 *
 * For 1800–2800 kcal this lands ~25–34 g. No upper limit is enforced — fiber has
 * no Tolerable Upper Intake Level; excess self-limits via GI comfort.
 *
 * The 25 g floor is a deliberate product choice (health minimum over a low
 * budget); it's a named constant so it's trivial to revisit if the owner wants
 * the lower RU ~20 g floor for very low budgets.
 */

/// Fiber grams per 1000 kcal — midpoint of the RU (10) and IOM (14) rates.
export const FIBER_G_PER_1000_KCAL = 12;

/// Never recommend below the EFSA/WHO adult minimum, whatever the budget.
export const FIBER_TARGET_FLOOR_G = 25;

/** Daily fiber goal in grams for a calorie budget. Non-positive/garbage → floor. */
export function fiberTargetG(budgetKcal: number): number {
  if (!Number.isFinite(budgetKcal) || budgetKcal <= 0) return FIBER_TARGET_FLOOR_G;
  return Math.max(FIBER_TARGET_FLOOR_G, Math.round((budgetKcal / 1000) * FIBER_G_PER_1000_KCAL));
}
