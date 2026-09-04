/// The ONE energy formula on the client — a mirror of
/// `server/src/nutrition/energy.ts`, kept deliberately identical so a number
/// typed on the phone and a number derived on the server can never disagree.
///
/// Coefficients are ТР ТС 022/2011 Приложение 4 (= FAO FNP 77 general factors
/// = EU 1169/2011 Annex XIV) — the law every Russian/EAEU label is computed
/// under: белок 4 · жир 9 · усвояемые углеводы 4 · пищевые волокна 2 ккал/г.
///
/// `carb` is TOTAL carbohydrate, fiber included (the convention the app stores,
/// docs/nutrition-science.md §1). Fiber is carved out of it and billed at its
/// own 2 kcal/g; a missing fiber reads as 0, so an absent field can only ever
/// UNDER-count, never inflate.
///
/// THE BOUNDARY: this DERIVES kcal where the macros are the trustworthy part —
/// the user's own manual entry — and must never overwrite a measured/curated
/// kcal from a database row (those legitimately differ by a few percent:
/// specific Atwater factors, polyols, rounding).

export interface EnergyMacros {
  prot: number;
  fat: number;
  /// TOTAL carbohydrate, fiber included.
  carb: number;
  /// Dietary fiber grams; absent → 0 (no discount, never inflation).
  fiber?: number;
}

/// ТР ТС 022/2011 / FAO FNP 77 / EU 1169/2011 energy factors (kcal per gram).
export const ATWATER = {
  prot: 4,
  fat: 9,
  carb: 4, // available carbohydrate (fiber removed first)
  fiber: 2,
} as const;

/// A non-negative, finite gram value (garbage/negatives → 0).
function nn(x: number | undefined): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0;
}

/// kcal from macros by the one fiber-aware formula (unrounded — callers round
/// to the precision they display).
export function energyFromMacros(m: EnergyMacros): number {
  const fiber = nn(m.fiber);
  const available = Math.max(0, nn(m.carb) - fiber);
  return ATWATER.prot * nn(m.prot) + ATWATER.fat * nn(m.fat) + ATWATER.carb * available + ATWATER.fiber * fiber;
}
