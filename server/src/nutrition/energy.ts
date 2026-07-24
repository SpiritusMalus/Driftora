/**
 * The single, fiber-aware energy formula — one way to turn macros into kcal,
 * used everywhere we DERIVE or CROSS-CHECK energy.
 *
 * Coefficients are ТР ТС 022/2011 Приложение 4 — the law every Russian/EAEU
 * label is computed under, and (not by coincidence) identical to FAO Food &
 * Nutrition Paper 77's "extensive general factor system" and EU Reg. 1169/2011
 * Annex XIV:
 *
 *   белок 4 · жир 9 · усвояемые углеводы 4 · пищевые волокна 2 ·
 *   сахароспирты 2,4 (эритрит 0) · этанол 7 · органические кислоты 3   (ккал/г)
 *
 * `carb` is TOTAL carbohydrate — it INCLUDES fiber (and any polyols), the
 * USDA-"by difference" / RU convention we store. So available carbohydrate =
 * carb − fiber − polyols, and fiber is billed at its own 2 kcal/g rather than 4.
 * A missing fiber value is treated as 0 (the formula degrades to the naïve
 * 4·carb), so an absent field can only ever UNDER-count, never inflate.
 *
 * THE BOUNDARY (see docs/nutrition-science.md §1): this DERIVES kcal only where
 * macros are the trustworthy part — the AI estimate, or a label that omits
 * energy — and CROSS-CHECKS a source's stated kcal for internal consistency. It
 * must NEVER overwrite a measured/curated kcal: that value legitimately differs
 * from the general formula (specific Atwater factors, polyols, rounding), and
 * the curated tables are closer to ground truth than our arithmetic.
 */

/** Macro grams (per 100 g, or per portion — the formula is linear either way). */
export interface EnergyMacros {
  prot: number;
  fat: number;
  /** TOTAL carbohydrate, fiber included (USDA "by difference" / RU convention). */
  carb: number;
  /** Dietary fiber grams; absent → 0 (no discount, never inflation). */
  fiber?: number;
  /** Sugar alcohols (excl. erythritol) grams; billed at 2.4 kcal/g. */
  polyol?: number;
  /** Erythritol grams; 0 kcal/g but still carved out of available carb. */
  erythritol?: number;
  /** Ethanol grams; 7 kcal/g. */
  ethanol?: number;
  /** Organic acids grams; 3 kcal/g. */
  organicAcid?: number;
}

/** ТР ТС 022/2011 / FAO FNP 77 / EU 1169/2011 energy factors (kcal per gram). */
export const ATWATER = {
  prot: 4,
  fat: 9,
  carb: 4, // available carbohydrate (fiber & polyols removed first)
  fiber: 2,
  polyol: 2.4,
  ethanol: 7,
  organicAcid: 3,
} as const;

/** A non-negative, finite gram value (garbage/negatives → 0). */
function nn(x: number | undefined): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * kcal from macros by the one fiber-aware formula. Fiber and polyols are carved
 * out of total carbohydrate and billed at their own factors; erythritol is
 * carved out and billed at 0.
 */
export function energyFromMacros(m: EnergyMacros): number {
  const fiber = nn(m.fiber);
  const polyol = nn(m.polyol);
  const erythritol = nn(m.erythritol);
  const available = Math.max(0, nn(m.carb) - fiber - polyol - erythritol);
  return (
    ATWATER.prot * nn(m.prot) +
    ATWATER.fat * nn(m.fat) +
    ATWATER.carb * available +
    ATWATER.fiber * fiber +
    ATWATER.polyol * polyol +
    ATWATER.ethanol * nn(m.ethanol) +
    ATWATER.organicAcid * nn(m.organicAcid)
  );
}

export interface EnergyGap {
  /** kcal the source stated. */
  stated: number;
  /** kcal our formula computes from the same macros. */
  computed: number;
  /** |stated − computed|, kcal. */
  absDiff: number;
  /** |stated − computed| / max(stated, computed, 1) — 0…1, robust near zero. */
  fraction: number;
}

/** Compares a source's stated kcal against the macro-derived value. */
export function energyGap(v: { kcal?: number } & EnergyMacros): EnergyGap {
  const stated = nn(v.kcal);
  const computed = energyFromMacros(v);
  const absDiff = Math.abs(stated - computed);
  return { stated, computed, absDiff, fraction: absDiff / Math.max(stated, computed, 1) };
}

/**
 * True when a source's stated kcal can't be reconciled with its own macros —
 * a signal the row is internally inconsistent (transposed fat↔carb, a per-serving
 * kcal against per-100g macros, an OCR slip). Needs BOTH a relative gap beyond
 * `tol` AND an absolute gap beyond `absFloor` kcal, so a 20-vs-12 kcal rounding
 * difference on a near-zero food never trips it. Defaults are deliberately loose
 * — this flags gross nonsense, not the few-percent spread between general and
 * specific Atwater factors.
 */
export function energyInconsistent(
  v: { kcal?: number } & EnergyMacros,
  { tol = 0.15, absFloor = 20 }: { tol?: number; absFloor?: number } = {},
): boolean {
  const { absDiff, fraction } = energyGap(v);
  return absDiff > absFloor && fraction > tol;
}
