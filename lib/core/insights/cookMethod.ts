import type { Per100 } from '../services/foodParser';

/// How a food was cooked. The DB per-100g row is treated as the neutral baseline
/// (`raw`); the other methods apply a COARSE multiplier on top. Because real
/// outcomes vary with oil, time and cut, any non-neutral method marks the item
/// `approximate` — we never present a fried-adjustment as exact DB fact.
export type CookMethod = 'raw' | 'boiled' | 'fried' | 'baked' | 'grilled' | 'stewed';

/// Display/selection order for the chip row.
export const COOK_METHODS: readonly CookMethod[] = [
  'raw',
  'boiled',
  'fried',
  'baked',
  'grilled',
  'stewed',
];

interface CookFactor {
  kcal: number;
  fat: number;
  prot: number;
  carb: number;
}

/// Coarse, defensible macro/kcal multipliers vs the DB baseline. These are
/// intentionally rough bands, not precise yields — protein and carbs are left at
/// ×1 (cooking adds neither; water-loss concentration is too variable to claim).
/// Sources are general USDA cooking-yield / fat-absorption observations.
const FACTORS: Record<CookMethod, CookFactor> = {
  // Baseline: the DB row as-is. No energy added.
  raw: { kcal: 1.0, fat: 1.0, prot: 1.0, carb: 1.0 },
  // Water cooking adds no energy; leaching is minor → treat as baseline.
  boiled: { kcal: 1.0, fat: 1.0, prot: 1.0, carb: 1.0 },
  // Pan/deep frying absorbs oil — the dominant kcal/fat driver (~+40% kcal,
  // fat can roughly double for pan-fried items). Coarse upper-ish band.
  fried: { kcal: 1.4, fat: 1.8, prot: 1.0, carb: 1.0 },
  // Baking/roasting: a little added fat + water-loss concentration.
  baked: { kcal: 1.1, fat: 1.15, prot: 1.0, carb: 1.0 },
  // Grilling: little added fat and some renders/drips off → near-neutral energy.
  grilled: { kcal: 1.05, fat: 1.0, prot: 1.0, carb: 1.0 },
  // Stewing: modest oil/fat carried in the sauce.
  stewed: { kcal: 1.1, fat: 1.3, prot: 1.0, carb: 1.0 },
};

/// True when the method leaves the baseline numbers unchanged (raw / boiled).
/// Used to decide whether the adjustment should raise the `approximate` flag.
export function isNeutralCookMethod(method: CookMethod): boolean {
  const f = FACTORS[method];
  return f.kcal === 1 && f.fat === 1 && f.prot === 1 && f.carb === 1;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/// Drink markers that are safe to match ANYWHERE in a name (unambiguous stems).
const DRINK_STEMS = [
  'напит', // напиток/напитка/напитки
  'лимонад',
  'энергетик',
  'коктейл',
  'смузи',
  'газиров',
  'минералк',
  'комбуч',
  'drink',
  'beverage',
  'juice',
  'lemonade',
  'cocktail',
  'smoothie',
  'milkshake',
  'kombucha',
];

/// Drink markers matched as EXACT word tokens (substrings would false-positive:
/// «вино» is in «свинина»). JS `\b` doesn't work for Cyrillic, so common RU case
/// forms are enumerated instead of stemmed. Bare EN 'milk' is deliberately
/// absent — "milk porridge" must stay cookable.
const DRINK_WORDS = new Set([
  ...['сок', 'сока', 'соку', 'соком', 'соке', 'соки', 'соков'],
  ...['кола', 'колы', 'пепси', 'спрайт', 'фанта', 'тархун', 'квас', 'кваса', 'морс', 'морса'],
  ...['компот', 'компота', 'кисель', 'киселя', 'цикорий'],
  ...['чай', 'чая', 'чаю', 'кофе', 'латте', 'капучино', 'эспрессо', 'американо', 'какао'],
  ...['вода', 'воды', 'водой', 'пиво', 'пива', 'вино', 'вина', 'сидр', 'шампанское', 'глинтвейн', 'пунш'],
  ...['водка', 'водки', 'виски', 'ром', 'рома', 'джин', 'коньяк', 'коньяка', 'ликёр', 'ликер'],
  ...['кефир', 'кефира', 'ряженка', 'ряженки', 'простокваша', 'айран', 'тан', 'молоко'],
  ...['tea', 'coffee', 'latte', 'cappuccino', 'espresso', 'americano', 'cocoa', 'water', 'soda'],
  ...['cola', 'pepsi', 'sprite', 'fanta', 'kvass', 'mors', 'compote', 'kissel'],
  ...['beer', 'wine', 'cider', 'champagne', 'vodka', 'whiskey', 'whisky', 'rum', 'gin', 'cognac', 'brandy', 'liqueur', 'punch'],
  ...['kefir', 'ryazhenka', 'ayran', 'milkshake'],
]);

/// Soup markers safe to match ANYWHERE in a name (unambiguous stems, ё folded
/// to е). Bare «суп»/'pho' are NOT here — they'd false-positive inside «суперфуд»
/// / 'phone', so they live in [SOUP_WORDS] as exact tokens instead.
const SOUP_STEMS = [
  'харчо',
  'борщ', // борща/борщи…
  'солянк',
  'окрошк',
  'рассольник',
  'свекольник',
  'похлебк', // похлёбка — hay is ё-folded
  'бульон',
  'шурп',
  'лагман',
  'минестроне',
  'гаспачо',
  'soup',
  'broth',
  'bouillon',
  'chowder',
  'bisque',
  'ramen',
  'borscht',
  'solyanka',
  'okroshka',
  'kharcho',
  'shchi',
  'ukha',
];

/// Soup markers matched as EXACT word tokens (substrings would false-positive:
/// «суп» is in «суперфуд»). Common RU case forms enumerated, as in [DRINK_WORDS].
const SOUP_WORDS = new Set([
  ...['суп', 'супа', 'супу', 'супом', 'супе', 'супы', 'супов', 'супам', 'супами', 'супах'],
  ...['супчик', 'супчика', 'супчику', 'супчиком', 'супчике', 'супчики'],
  ...['уха', 'ухи', 'ухе', 'уху', 'ухой'],
  ...['щи', 'щей', 'щам', 'щами', 'щах'],
  ...['pho'],
]);

/// Whether the "how it was cooked" adjustment makes sense for this food at all.
/// Drinks (энергетики, соки, кофе…) are consumed as-is — offering «жареное» for
/// a can of energy drink is nonsense, and a stray chip tap would silently
/// inflate its kcal. Soups are out for a stronger reason: their DB row already
/// describes the FINISHED dish (you can't fry a soup), so a cook adjustment
/// would double-count — and the default «сырое» chip reads absurd on «харчо».
/// The wire contract carries no category, so this is a client-side name
/// heuristic over BOTH names (the LLM always returns name_en); server-flagged
/// ready dishes (`prepared`) are handled by the caller on top of this.
/// False positives are benign: the item just keeps its DB baseline.
export function cookMethodApplies(nameRu: string, nameEn: string): boolean {
  // ё→е so «похлёбка»/«похлебка» hit the same stem (mirrors the server-side
  // normalizeRu fold). The drink lists predate the fold and keep both forms.
  const hay = `${nameRu} ${nameEn}`.toLowerCase().replace(/ё/g, 'е');
  if (DRINK_STEMS.some((s) => hay.includes(s))) return false;
  if (SOUP_STEMS.some((s) => hay.includes(s))) return false;
  const tokens = hay.split(/[^a-zа-яё]+/u);
  return !tokens.some((tok) => DRINK_WORDS.has(tok) || SOUP_WORDS.has(tok));
}

/// Apply a cooking method's coarse factors to a DB baseline per-100g block.
/// Pure + deterministic; minerals and `source` pass through unchanged (per-method
/// mineral changes are out of scope for v1). `raw` is the identity.
export function applyCookFactor(base: Per100, method: CookMethod): Per100 {
  const f = FACTORS[method];
  return {
    ...base,
    kcal: Math.round(base.kcal * f.kcal),
    prot: round1(base.prot * f.prot),
    fat: round1(base.fat * f.fat),
    carb: round1(base.carb * f.carb),
  };
}
