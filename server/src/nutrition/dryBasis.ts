import type { Minerals, Per100 } from '../types.js';

/**
 * Honest "these numbers are on the DRY product" hint.
 *
 * Instant noodles, pasta, rice and groats are sold DRY, and every packaged /
 * branded database (OFF etiquette, USDA "…, dry") states composition per 100 g
 * of the DRY product — ~330–470 kcal. Cooked, the same portion weighs 2.5–3× as
 * much (absorbed water) at ~90–160 kcal/100 g. So if the user weighs the FINISHED
 * dish and the matched row's density is a dry one, `grams × per100` overcounts
 * roughly threefold (the reported "1400 kcal on 350 g" case).
 *
 * We do NOT rewrite the numbers (raw→cooked yield is too food-specific to fake)
 * — we only RAISE A FLAG so the client can say "this looks like a dry-product
 * label; check the weight" and let the user pick a cooked DB row or re-query.
 * THE HONESTY RULE: show the fact, let the user decide.
 *
 * Trigger = a starch normally eaten cooked (name match) AND a density only a dry
 * basis reaches. The kcal floor is what separates the two states cleanly:
 * cooked rice/pasta/noodles sit well under it, dry ones well over. A curated
 * "…варёная/готовая" row (low density) never trips it; neither does a
 * legitimately dense food outside the starch list (nuts, oil, chocolate).
 */

/// Starches sold dry but eaten cooked (RU + the LLM's English names).
/// «рис» needs a hand-made Cyrillic word start — JS \b is ASCII-only, so
/// `\bрис` matched inside «ириска»/«барбариски» and flagged candy as rice.
const DRY_STARCH_RE =
  /(лапш|макарон|вермишел|спагетти|паст[аы]|(?<![а-яё])рис|греч|булгур|кускус|перловк|овсянк|геркулес|пюре|noodle|pasta|spaghetti|vermicelli|\brice\b|buckwheat|groat|oatmeal|couscous|bulgur|instant\s+mash)/i;

/// Below this, a starch is plausibly already cooked; at/above it the per-100g is
/// almost certainly a dry-product label (cooked starches don't reach it).
const DRY_KCAL_FLOOR = 250;

/// Above this, the density is a fat-based spread's, not a dry starch's:
/// «арахисовая/шоколадная/кунжутная паста» live at ~530–590, while real dry
/// starches top out lower (pasta/rice/groats 330–390, fried instant noodles
/// 400–470). Without the ceiling, the «паст…» word match handed nut spreads a
/// dry-basis warning AND an invented «готовое» alternative at ÷2.5 kcal.
const DRY_KCAL_CEIL = 500;

/// Below this a starch row is describing the COOKED state: boiled rice, pasta
/// and groats live at ~90–160 kcal/100 g, and nothing dry comes anywhere near
/// it. The gap between this and [DRY_KCAL_FLOOR] is deliberately left as
/// «unknown»: a row in it (a drained-but-dense pilaf, an unclear crowd entry)
/// states neither basis clearly, and guessing there is how you break the honest
/// half of the corpus.
const COOKED_KCAL_CEIL = 200;

/**
 * WHICH STATE a matched row describes — the row half of the basis pair.
 *
 * A weight and a per-100g row each carry their own basis (dry product vs the
 * finished dish), and `grams × per100` is only true when the two agree. This
 * says what the ROW is; [IdentifiedItem.weightBasis] says what the WEIGHT is.
 * Neither is judged without the other — see the resolver.
 *
 * Only starches are classified: they are the foods whose two states differ by
 * a factor of three. Everything else answers 'unknown' and is left alone.
 */
export function rowBasis(names: (string | undefined)[], per100: Per100): Basis {
  if (per100.source === 'estimate') return 'unknown'; // a fabricated placeholder isn't a label
  const hay = names.filter((n) => typeof n === 'string' && n.length > 0).join(' ');
  if (!DRY_STARCH_RE.test(hay)) return 'unknown';
  if (per100.kcal >= DRY_KCAL_FLOOR && per100.kcal <= DRY_KCAL_CEIL) return 'dry';
  if (per100.kcal > 0 && per100.kcal < COOKED_KCAL_CEIL) return 'cooked';
  return 'unknown';
}

/** The state a weight or a per-100g row is stated in. */
export type Basis = 'dry' | 'cooked' | 'unknown';

/**
 * True when `per100` looks like a DRY-product label for a starch the user most
 * likely weighed cooked. `names` = every name we can check (logged RU/EN + the
 * matched DB row's own name — the row name is the strongest signal of state).
 */
export function looksDryBasis(names: (string | undefined)[], per100: Per100): boolean {
  return rowBasis(names, per100) === 'dry';
}

/**
 * Cooked/dry weight ratios for the starches [looksDryBasis] flags — how many
 * grams of finished dish 100 g of the DRY product becomes (USDA Cooking Yields
 * for grains + Bognár tables; docs/nutrition-science.md §6). 100 g dry carries
 * its whole kcal spread across `factor`× the cooked weight, so the COOKED
 * per-100g is simply the dry per-100g ÷ factor.
 *
 * Only well-sourced starches are listed. Instant mash / «пюре» is deliberately
 * absent — its reconstitution ratio (with water vs milk vs butter) is too
 * variable to put a number on, so those keep the dry-basis WARNING but get no
 * one-tap conversion. First match wins.
 */
const DRY_STARCH_YIELD: readonly { re: RegExp; factor: number }[] = [
  { re: /греч|buckwheat|groat/, factor: 3.6 },
  { re: /овсянк|геркулес|oatmeal/, factor: 3.0 },
  { re: /булгур|bulgur/, factor: 2.8 },
  { re: /кускус|couscous/, factor: 2.8 },
  { re: /(?<![а-яё])рис|\brice\b/, factor: 2.9 },
  { re: /перловк/, factor: 2.5 },
  { re: /лапш|макарон|вермишел|спагетти|паст[аы]|noodle|pasta|spaghetti|vermicelli/, factor: 2.5 },
];

/**
 * The cooked-weight yield factor for a dry starch named in `names`, or null when
 * none is recognised — the food still gets the dry-basis warning via
 * [looksDryBasis], it just can't be offered a one-tap cooked conversion.
 */
export function dryStarchYield(names: (string | undefined)[]): number | null {
  const hay = names
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .join(' ')
    .toLowerCase();
  for (const { re, factor } of DRY_STARCH_YIELD) if (re.test(hay)) return factor;
  return null;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/**
 * Converts a DRY-basis per-100g into its COOKED-basis equivalent by dividing
 * every value by the yield `factor` (per-100g cooked = per-100g dry ÷ factor).
 * Macros, the extra label fields (fiber/sugar/satFat) and minerals all dilute by
 * the same water uptake. Never mutates the input; keeps the original `source`.
 */
export function cookedFromDry(per100: Per100, factor: number): Per100 {
  return rebase(per100, 1 / factor);
}

/**
 * The MIRROR conversion: a COOKED-basis per-100g re-stated on the DRY product
 * the weight refers to (per-100g dry = per-100g cooked × factor). Same water
 * uptake, read the other way — 100 g of the dry pack becomes `factor`× that
 * weight cooked, so the dry product is `factor`× as dense.
 */
export function dryFromCooked(per100: Per100, factor: number): Per100 {
  return rebase(per100, factor);
}

/** Scales every nutrient of a per-100g by `mult`; never mutates the input. */
function rebase(per100: Per100, mult: number): Per100 {
  const div = (x: number) => x * mult;
  const minerals: Minerals = {};
  for (const [k, v] of Object.entries(per100.minerals)) {
    if (typeof v === 'number' && Number.isFinite(v)) minerals[k as keyof Minerals] = round1(div(v));
  }
  const out: Per100 = {
    ...per100,
    kcal: Math.round(div(per100.kcal)),
    prot: round1(div(per100.prot)),
    fat: round1(div(per100.fat)),
    carb: round1(div(per100.carb)),
    minerals,
  };
  for (const key of ['fiber', 'sugar', 'satFat'] as const) {
    if (typeof per100[key] === 'number') out[key] = round1(div(per100[key] as number));
  }
  return out;
}
