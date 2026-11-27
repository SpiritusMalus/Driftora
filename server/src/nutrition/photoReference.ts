import type { IdentifiedItem, Per100 } from '../types.js';
import { normalizeName } from './scoring.js';
import { SKURIKHIN_TABLE } from './skurikhinData.js';

interface Reference {
  name: string;
  per100: Per100;
}

// FoodData Central SR Legacy. These entries supplement the existing local table.
const cookedBroccoli: Reference = { // FDC 169967
  name: 'брокколи приготовленная',
  per100: { source: 'usda', kcal: 35, prot: 2.38, fat: 0.41, carb: 7.18, fiber: 3.3,
    minerals: { na: 41, k: 293, ca: 40, mg: 21, fe: 0.67, zn: 0.45 },
    vitamins: { a: 77, c: 64.9, e: 1.45, b1: 0.063, b6: 0.2, b9: 108 } },
};
const roastedSweetPotato: Reference = { // FDC 168483
  name: 'батат запечённый',
  per100: { source: 'usda', kcal: 90, prot: 2.01, fat: 0.15, carb: 20.71, fiber: 3.3,
    minerals: { na: 36, k: 475, ca: 38, mg: 27, fe: 0.69, zn: 0.32 },
    vitamins: { a: 961, c: 19.6, e: 0.71, b1: 0.107, b6: 0.286, b9: 6 } },
};
const whiteSauce: Reference = { // FDC 174525, homemade white sauce, medium
  name: 'белый соус домашний',
  per100: { source: 'usda', kcal: 147, prot: 3.84, fat: 10.63, carb: 9.17, fiber: 0.2,
    minerals: { na: 354, k: 156, ca: 118, mg: 14, fe: 0.33, zn: 0.41 },
    vitamins: { a: 104, d: 1.2, c: 0.8, e: 0.29, b1: 0.069, b6: 0.04, b9: 8, b12: 0.28 } },
};

function tableReference(name: string): Reference | undefined {
  const row = SKURIKHIN_TABLE.find((entry) => entry.name === name);
  return row && { name, per100: { source: row.source ?? 'skurikhin', ...row.per100 } };
}

const SALMON = /(?:^| )(?:salmon|лосось|лосося|семг[аи])(?: |$)/u;
const TROUT = /\btrout\b|(?:^| )форел[ьи](?: |$)/u;
const DRUMSTICK = /\bdrumsticks?\b|курин\p{L}* голен\p{L}*|голен\p{L}* (?:курин\p{L}*|курицы)/u;
const CHICKEN_BREAST = /\bchicken breast\b|курин\p{L}* грудк\p{L}*/u;
const BROCCOLI = /\bbroccoli\b|(?:^| )брокколи(?: |$)/u;
const SWEET_POTATO = /\bsweet potato(?:es)?\b|(?:^| )батат\p{L}*(?: |$)|сладкий картофель/u;
const POTATO = /(?<!sweet )\bpotato(?:es)?\b|(?<!сладкий )(?<!\p{L})картофел\p{L}*(?: |$)|(?:^| )картошк\p{L}*(?: |$)/u;
const WHITE_SAUCE = /\b(?:b[eé]chamel|white sauce|cream sauce)\b|(?:^| )бешамель(?: |$)|(?:белый|сливочный) соус/u;
const RICE = /\brice\b|(?:^| )рис(?: |$)/u;
const BROWN_RICE = /\bbrown rice\b|(?:бурый|коричневый) рис|рис (?:бурый|коричневый)/u;
const STRAWBERRY = /\bstrawberr(?:y|ies)\b|(?:^| )(?:клубник\p{L}*|земляник\p{L}*)(?: |$)/u;
// Ingredient products use the same words in their titles: "cheese for Greek
// salad" and "Greek salad dressing" still describe only part of the dish.
const GREEK_SALAD = /^(?:(?:classic|traditional|fresh|классическ\p{L}*|традиционн\p{L}*) )?(?:greek (?:style )?salad|salad greek|салат греческ\p{L}*|греческ\p{L}* салат|horiatiki|хориатики)(?: |$)/u;
const SHIRAZI_SALAD = /^(?:(?:classic|traditional|fresh|иранск\p{L}*|персидск\p{L}*) )?(?:shirazi salad|salad shirazi|салат ширази|ширази)(?: |$)/u;
const SALAD_ADD_ON = /^(?:cheese\b|feta\b|dressing\b|sauce\b|seasoning\b|topping\b|сыр|фета|заправк|соус|приправа)/u;
const BANANA = /\bbanana\b|(?:^| )банан(?: |$)/u;
const LEMON = /\blemon\b|(?:^| )лимон\p{L}*(?: |$)/u;

interface PhotoRule {
  identity: RegExp;
  words: RegExp;
  reference: Reference | undefined;
  cooking?: RegExp;
  portionWords?: RegExp;
}

const COOKED = /\b(?:cooked|boiled|steamed)\b|варен|отвар|приготовлен|на пару/u;
const DRY_HEAT = /\b(?:roasted|grilled|baked|seared|cooked|fried|broiled)\b|запечен|печен|грил|жарен|сковород/u;
const PROTEIN_PORTION = /^(?:plain|whole|fillets?|filets?|steaks?|pieces?|cuts?|of|pan|oven|roasted|grilled|baked|seared|cooked|fried|broiled|филе|стейк\p{L}*|кус(?:ок|ки|очек)|целиком|цел\p{L}*|запечен\p{L}*|печен\p{L}*|жарен\p{L}*|обжарен\p{L}*|на|в|из|гриле|гриль|духовке|сковороде)$/u;
const RICE_WORDS = /^(?:rice|white|plain|cooked|boiled|steamed|рис|белый|обычный|простой|вареный|отварной|отваренный|приготовленный|на|пару)$/u;
const FISH = /\b(?:fish|salmon|trout)\b|(?:^| )(?:рыб[аыу]|лосось|лосося|семг[аи]|форел[ьи])(?: |$)/u;
const COMPOSITE_FISH = /\b(?:sandwich\w*|burgers?|wraps?|soups?|salads?|sauces?|pates?|spreads?|sticks?|cakes?)\b|сэндвич|сендвич|бутерброд|бургер|ролл|суп|салат|соус|паштет|котлет|палочк/u;
const GENERIC_FISH_WORD = /^(?:fish|white|рыба|рыбы|белая)$/u;

const RULES: readonly PhotoRule[] = [
  { identity: SALMON, cooking: DRY_HEAT, reference: tableReference('лосось запечённый'),
    words: /^(salmon|atlantic|лосось|лосося|семг[аи]|атлантическ\p{L}*)$/u, portionWords: PROTEIN_PORTION },
  { identity: TROUT, cooking: DRY_HEAT, reference: tableReference('форель запечённая'),
    words: /^(trout|rainbow|форел[ьи]|радужн\p{L}*)$/u, portionWords: PROTEIN_PORTION },
  { identity: DRUMSTICK, cooking: DRY_HEAT, reference: tableReference('куриная голень запечённая'),
    words: /^(chicken|drumsticks?|курин\p{L}*|голен\p{L}*|курицы)$/u, portionWords: PROTEIN_PORTION },
  { identity: CHICKEN_BREAST, cooking: DRY_HEAT, reference: tableReference('куриная грудка запечённая'),
    words: /^(chicken|breasts?|курин\p{L}*|грудк\p{L}*)$/u, portionWords: PROTEIN_PORTION },
  { identity: BROCCOLI, cooking: /baked|roasted|запечен|печен|cooked|boiled|steamed|варен|отвар|приготовлен|на пару/u,
    reference: cookedBroccoli,
    words: /^(broccoli|florets?|plain|roasted|baked|cooked|boiled|steamed|брокколи|соцветия|запеченн\p{L}*|печен\p{L}*|варен\p{L}*|отварн\p{L}*|приготовлен\p{L}*|на|пару)$/u },
  { identity: SWEET_POTATO, cooking: DRY_HEAT, reference: roastedSweetPotato,
    words: /^(sweet|potato(?:es)?|roasted|baked|cooked|sliced|slices?|plain|батат\p{L}*|сладкий|картофель|запеченн\p{L}*|печен\p{L}*|ломтики|ломтик|кружочки)$/u },
  { identity: POTATO, cooking: COOKED, reference: tableReference('картофель варёный'),
    words: /^(potato(?:es)?|boiled|cooked|steamed|peeled|plain|картофел\p{L}*|картошк\p{L}*|варен\p{L}*|отварн\p{L}*|приготовлен\p{L}*|на|пару)$/u },
  { identity: WHITE_SAUCE, reference: whiteSauce,
    words: /^(b[eé]chamel|white|cream|sauce|соус|бешамель|белый|сливочный)$/u },
  { identity: BROWN_RICE, reference: tableReference('рис бурый варёный'),
    words: /^(brown|бурый|коричневый)$/u, portionWords: RICE_WORDS },
  { identity: RICE, reference: tableReference('рис белый варёный'), words: RICE_WORDS },
  { identity: STRAWBERRY, reference: tableReference('клубника'),
    words: /^(strawberr(?:y|ies)|raw|fresh|ripe|whole|sliced|berries|клубник\p{L}*|земляник\p{L}*|свеж\p{L}*|сыр(?:ая|ую|ые|ой|ых|ого|ом|ым)|спел\p{L}*|цельн\p{L}*|цела\p{L}*|нарезан\p{L}*|ягод\p{L}*|садов\p{L}*)$/u },
  { identity: BANANA, reference: tableReference('банан'),
    words: /^(banana|raw|fresh|ripe|peeled|банан|сырой|свежий|спелый|очищенный)$/u },
  { identity: LEMON, reference: tableReference('лимон'),
    words: /^(lemon|raw|fresh|slice|sliced|wedge|лимон\p{L}*|ломтик|долька|свежий)$/u },
];

function photoNames(item: IdentifiedItem): string[] {
  return [normalizeName(item.name_ru), normalizeName(item.name_en)].filter(Boolean);
}

/** Use a stable row only for a plain food with compatible labels in both languages. */
export function mealPhotoReference(item: IdentifiedItem): Reference | undefined {
  if (item.packaged || item.label || item.weight_basis === 'dry') return;
  const names = photoNames(item);
  if (names.length === 0) return;
  return RULES.find(({ identity, words, cooking, portionWords }) =>
    names.every((name) => identity.test(name) && name.split(' ').every((word) =>
      words.test(word) || portionWords?.test(word))) &&
    (cooking ? names.some((name) => cooking.test(name)) :
      ![RICE, BROWN_RICE].includes(identity) || item.weight_basis === 'as_eaten' || names.some((name) => COOKED.test(name)))
  )?.reference;
}

const DIFFERENT_FORMS = [
  /(?:^| )(?:кожур\p{L}*|potato skins?)(?: |$)/u,
  /(?:^| )(?:в панировке|breaded|battered)(?: |$)/u,
  /(?:^| )(?:шарики?|balls?|nuggets?|наггетс\p{L}*)(?: |$)/u,
];

function isWholeSalad(name: string, identity: RegExp): boolean {
  const title = identity.exec(name);
  return title !== null && !SALAD_ADD_ON.test(name.slice(title[0].length));
}

/** Strong food identities survive both provider ranking and weak-match fallback. */
export function mealPhotoCandidateFilter(item: IdentifiedItem): ((candidate: string) => boolean) | undefined {
  if (item.packaged || item.label) return;
  const names = photoNames(item);
  const identities = RULES.filter(({ identity }) => names.some((name) => identity.test(name)));
  const salads = [GREEK_SALAD, SHIRAZI_SALAD].filter((identity) => names.some((name) => isWholeSalad(name, identity)));
  const plainFish = names.some((name) => FISH.test(name)) && names.every((name) => !COMPOSITE_FISH.test(name));
  const genericFish = plainFish && names.every((name) => name.split(' ').every((word) =>
    GENERIC_FISH_WORD.test(word) || PROTEIN_PORTION.test(word)));
  if (!plainFish && salads.length === 0 && identities.length === 0) return;
  const forbiddenForms = DIFFERENT_FORMS.filter((form) => names.every((name) => !form.test(name)));
  return (candidate) => {
    const name = normalizeName(candidate);
    return salads.every((identity) => isWholeSalad(name, identity)) &&
      (!plainFish || !COMPOSITE_FISH.test(name)) &&
      (!genericFish || (FISH.test(name) && name.split(' ').every((word) =>
        GENERIC_FISH_WORD.test(word) || PROTEIN_PORTION.test(word)))) &&
      identities.every(({ identity }) => identity.test(name)) &&
      forbiddenForms.every((form) => !form.test(name));
  };
}
