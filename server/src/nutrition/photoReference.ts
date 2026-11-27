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
const DRUMSTICK = /\bdrumsticks?\b|курин\p{L}* голен\p{L}*/u;
const BROCCOLI = /\bbroccoli\b|(?:^| )брокколи(?: |$)/u;
const SWEET_POTATO = /\bsweet potato(?:es)?\b|(?:^| )батат\p{L}*(?: |$)|сладкий картофель/u;
const POTATO = /(?<!sweet )\bpotato(?:es)?\b|(?<!сладкий )(?<!\p{L})картофел\p{L}*(?: |$)|(?:^| )картошк\p{L}*(?: |$)/u;
const WHITE_SAUCE = /\b(?:b[eé]chamel|white sauce|cream sauce)\b|(?:^| )бешамель(?: |$)|(?:белый|сливочный) соус/u;
const RICE = /\brice\b|(?:^| )рис(?: |$)/u;
const STRAWBERRY = /\bstrawberr(?:y|ies)\b|(?:^| )(?:клубник\p{L}*|земляник\p{L}*)(?: |$)/u;
// Ingredient products use the same words in their titles: "cheese for Greek
// salad" and "Greek salad dressing" still describe only part of the dish.
const GREEK_SALAD = /^(?:(?:classic|traditional|fresh|классическ\p{L}*|традиционн\p{L}*) )?(?:greek (?:style )?salad|salad greek|салат греческ\p{L}*|греческ\p{L}* салат|horiatiki|хориатики)(?: |$)/u;
const SALAD_ADD_ON = /^(?:cheese\b|feta\b|dressing\b|sauce\b|seasoning\b|topping\b|сыр|фета|заправк|соус|приправа)/u;
const BANANA = /\bbanana\b|(?:^| )банан(?: |$)/u;
const LEMON = /\blemon\b|(?:^| )лимон\p{L}*(?: |$)/u;

interface PhotoRule {
  identity: RegExp;
  words: RegExp;
  reference: Reference | undefined;
  cooking?: RegExp;
}

const COOKED = /\b(?:cooked|boiled|steamed)\b|варен|отвар|приготовлен|на пару/u;
const DRY_HEAT = /\b(?:roasted|grilled|baked|seared|cooked)\b|запечен|печен|грил|жарен/u;

const RULES: readonly PhotoRule[] = [
  { identity: SALMON, cooking: DRY_HEAT, reference: tableReference('лосось запечённый'),
    words: /^(salmon|fillet|filet|plain|baked|roasted|grilled|pan|seared|cooked|лосось|лосося|семг[аи]|филе|запеченн\p{L}*|печен\p{L}*|жарен\p{L}*|на|гриле|гриль)$/u },
  { identity: DRUMSTICK, cooking: DRY_HEAT, reference: tableReference('куриная голень запечённая'),
    words: /^(chicken|drumsticks?|roasted|baked|grilled|cooked|plain|курин\p{L}*|голен\p{L}*|запеченн\p{L}*|печен\p{L}*|жарен\p{L}*|на|гриле|гриль)$/u },
  { identity: BROCCOLI, cooking: /baked|roasted|запечен|печен|cooked|boiled|steamed|варен|отвар|приготовлен|на пару/u,
    reference: cookedBroccoli,
    words: /^(broccoli|florets?|plain|roasted|baked|cooked|boiled|steamed|брокколи|соцветия|запеченн\p{L}*|печен\p{L}*|варен\p{L}*|отварн\p{L}*|приготовлен\p{L}*|на|пару)$/u },
  { identity: SWEET_POTATO, cooking: DRY_HEAT, reference: roastedSweetPotato,
    words: /^(sweet|potato(?:es)?|roasted|baked|cooked|sliced|slices?|plain|батат\p{L}*|сладкий|картофель|запеченн\p{L}*|печен\p{L}*|ломтики|ломтик|кружочки)$/u },
  { identity: POTATO, cooking: COOKED, reference: tableReference('картофель варёный'),
    words: /^(potato(?:es)?|boiled|cooked|steamed|peeled|plain|картофел\p{L}*|картошк\p{L}*|варен\p{L}*|отварн\p{L}*|приготовлен\p{L}*|на|пару)$/u },
  { identity: WHITE_SAUCE, reference: whiteSauce,
    words: /^(b[eé]chamel|white|cream|sauce|соус|бешамель|белый|сливочный)$/u },
  { identity: RICE, reference: tableReference('рис белый варёный'),
    words: /^(rice|white|plain|cooked|boiled|steamed|рис|белый|обычный|простой|вареный|отварной|отваренный|приготовленный)$/u },
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
  return RULES.find(({ identity, words, cooking }) =>
    names.every((name) => identity.test(name) && name.split(' ').every((word) => words.test(word))) &&
    (cooking ? names.some((name) => cooking.test(name)) :
      identity !== RICE || item.weight_basis === 'as_eaten' || names.some((name) => COOKED.test(name)))
  )?.reference;
}

const DIFFERENT_FORMS = [
  /(?:^| )(?:кожур\p{L}*|potato skins?)(?: |$)/u,
  /(?:^| )(?:в панировке|breaded|battered)(?: |$)/u,
  /(?:^| )(?:шарики?|balls?|nuggets?|наггетс\p{L}*)(?: |$)/u,
];

function isGreekSalad(name: string): boolean {
  const title = GREEK_SALAD.exec(name);
  return title !== null && !SALAD_ADD_ON.test(name.slice(title[0].length));
}

/** Strong food identities survive both provider ranking and weak-match fallback. */
export function mealPhotoCandidateFilter(item: IdentifiedItem): ((candidate: string) => boolean) | undefined {
  if (item.packaged || item.label) return;
  const names = photoNames(item);
  const identities = RULES.filter(({ identity }) => names.some((name) => identity.test(name)));
  const greekSalad = names.some(isGreekSalad);
  if (!greekSalad && identities.length === 0) return;
  const forbiddenForms = DIFFERENT_FORMS.filter((form) => names.every((name) => !form.test(name)));
  return (candidate) => {
    const name = normalizeName(candidate);
    return (!greekSalad || isGreekSalad(name)) &&
      identities.every(({ identity }) => identity.test(name)) &&
      forbiddenForms.every((form) => !form.test(name));
  };
}
