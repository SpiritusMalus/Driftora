/**
 * Portion priors — category defaults, bulk densities and honest uncertainty
 * bands for turning a guessed portion into grams (docs/nutrition-science.md §8).
 *
 * Portion/mass is the single largest error source in food logging, and it feeds
 * calorie error almost 1:1. When the user hasn't stated a weight, these give a
 * defensible default (USDA FNDDS / FDA RACC reference amounts) and — if a volume
 * can be estimated — a density (FAO/INFOODS Density DB v2.0) to convert it to
 * mass. Each category also carries the *measured* spread of human/vision portion
 * estimates, so the caller can size the «≈» honestly instead of one flat ±.
 *
 * This is the reference core only; mapping a logged food to a category, and
 * deciding when to prompt for a weight, are wired at the call site (the model
 * already identifies the food). Nothing here guesses — a default is labelled a
 * default, and its uncertainty says how rough it is.
 */

export type PortionCategory =
  | 'grainCooked' // варёные крупа/паста/картофель
  | 'meat' // мясо/рыба/птица, опознанный кусок
  | 'vegetable' // овощи россыпью, без соуса
  | 'fruit' // фрукт/ягоды
  | 'soup' // суп/бульон
  | 'sauce' // соусы/заправки/масло — визуально НЕ оценивать
  | 'beverage' // напитки
  | 'nuts' // орехи/семена
  | 'bread' // хлеб/выпечка ломтиком
  | 'mixedDish'; // составное блюдо неопознанное

interface PortionPrior {
  /** RACC/FNDDS default serving mass, grams (used when no weight/volume is known). */
  defaultG: number;
  /** Bulk density g/mL (FAO/INFOODS), to convert an estimated volume to mass. */
  densityGPerMl: number;
  /** Measured ± spread of portion estimates for this category (fraction of mass). */
  uncertainty: number;
}

const PRIORS: Record<PortionCategory, PortionPrior> = {
  grainCooked: { defaultG: 140, densityGPerMl: 0.68, uncertainty: 0.28 },
  meat: { defaultG: 85, densityGPerMl: 1.02, uncertainty: 0.22 },
  vegetable: { defaultG: 85, densityGPerMl: 0.55, uncertainty: 0.3 },
  fruit: { defaultG: 140, densityGPerMl: 0.6, uncertainty: 0.18 },
  soup: { defaultG: 245, densityGPerMl: 1.03, uncertainty: 0.22 },
  sauce: { defaultG: 15, densityGPerMl: 1.05, uncertainty: 0.75 },
  beverage: { defaultG: 240, densityGPerMl: 1.0, uncertainty: 0.4 },
  nuts: { defaultG: 30, densityGPerMl: 0.55, uncertainty: 0.18 },
  bread: { defaultG: 50, densityGPerMl: 0.29, uncertainty: 0.18 },
  mixedDish: { defaultG: 250, densityGPerMl: 0.85, uncertainty: 0.35 },
};

export interface PortionEstimate {
  grams: number;
  /** ± fraction of `grams` — how wide to draw the «≈» for this portion. */
  uncertainty: number;
}

/**
 * Best mass estimate for a category: from an estimated volume × the category's
 * density when a volume is given, else the category's default serving. Always
 * returns the category's honest uncertainty band alongside.
 */
export function estimatePortion(category: PortionCategory, opts: { volumeMl?: number } = {}): PortionEstimate {
  const prior = PRIORS[category];
  const grams =
    typeof opts.volumeMl === 'number' && Number.isFinite(opts.volumeMl) && opts.volumeMl > 0
      ? Math.round(opts.volumeMl * prior.densityGPerMl)
      : prior.defaultG;
  return { grams, uncertainty: prior.uncertainty };
}

/** The category's default serving mass in grams (when nothing else is known). */
export function defaultPortionG(category: PortionCategory): number {
  return PRIORS[category].defaultG;
}

/** The category's measured portion-estimate uncertainty (± fraction of mass). */
export function portionUncertainty(category: PortionCategory): number {
  return PRIORS[category].uncertainty;
}
