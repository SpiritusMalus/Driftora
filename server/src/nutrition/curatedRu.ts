import type { SkurikhinEntry } from './skurikhinTypes.js';

/**
 * Hand-curated RU composition rows for common foods ABSENT from the
 * USDA-SR-Legacy import in `skurikhinData.ts` (that file is auto-generated — do
 * not hand-edit it; add to this list instead). These are national dishes and
 * everyday RU items (супы / салаты / вторые / каши / выпечка) the resolver
 * otherwise missed → fell back to the coarse `estimate`, which the UI shows as
 * "not in our database".
 *
 * Per-100g values are standard published Russian composition figures for the
 * classic recipe of each dish (editorial calorie-table rows, not user recipes);
 * provenance is attributed as 'skurikhin' (curated RU table) so the UI labels
 * them honestly. Composite dishes vary by recipe — these are the reference
 * figures, and the client's "не то?" picker + food_choices memory let the user
 * correct any specific case. Minerals are left empty for now (macros are the
 * figures we can stand behind).
 *
 * `prepared: true` marks rows that are FINISHED dishes as served (супы, салаты,
 * готовые вторые, каши, выпечка): their per-100g already describes the cooked
 * dish, so the client hides the cooking-method chips («сырое» on a soup reads
 * absurd, and a fry-adjustment would double-count). Products still cooked at
 * home stay unmarked so the chips remain available.
 */
export const CURATED_RU: SkurikhinEntry[] = [
  // — Супы (классические рецептуры; на 100 г готового блюда) —
  { name: 'борщ', aliases: ['борщ', 'борщ украинский'], source: 'skurikhin', prepared: true,
    per100: { kcal: 49, prot: 1.1, fat: 2.2, carb: 6.7, minerals: {} } },
  { name: 'борщ с мясом', aliases: ['борщ с мясом', 'борщ с говядиной', 'борщ со свининой'], source: 'skurikhin', prepared: true,
    per100: { kcal: 63, prot: 4.4, fat: 3.6, carb: 5.5, minerals: {} } },
  { name: 'щи', aliases: ['щи', 'щи из свежей капусты'], source: 'skurikhin', prepared: true,
    per100: { kcal: 38, prot: 1, fat: 3.8, carb: 2.1, minerals: {} } },
  { name: 'щи из квашеной капусты', aliases: ['щи из квашеной капусты', 'щи кислые'], source: 'skurikhin', prepared: true,
    per100: { kcal: 32, prot: 0.6, fat: 2.1, carb: 2.7, minerals: {} } },
  { name: 'солянка', aliases: ['солянка', 'солянка мясная', 'солянка сборная'], source: 'skurikhin', prepared: true,
    per100: { kcal: 69, prot: 5.2, fat: 4.6, carb: 1.7, minerals: {} } },
  { name: 'рассольник', aliases: ['рассольник'], source: 'skurikhin', prepared: true,
    per100: { kcal: 42, prot: 1.4, fat: 2, carb: 5, minerals: {} } },
  { name: 'окрошка', aliases: ['окрошка', 'окрошка на квасе'], source: 'skurikhin', prepared: true,
    per100: { kcal: 52, prot: 2.1, fat: 1.7, carb: 6.3, minerals: {} } },
  { name: 'окрошка на кефире', aliases: ['окрошка на кефире'], source: 'skurikhin', prepared: true,
    per100: { kcal: 47, prot: 3.1, fat: 1.9, carb: 4.3, minerals: {} } },
  { name: 'уха', aliases: ['уха', 'рыбный суп'], source: 'skurikhin', prepared: true,
    per100: { kcal: 46, prot: 3.4, fat: 1, carb: 5.5, minerals: {} } },
  { name: 'гороховый суп', aliases: ['гороховый суп', 'суп гороховый'], source: 'skurikhin', prepared: true,
    per100: { kcal: 66, prot: 4.4, fat: 2.4, carb: 8.9, minerals: {} } },
  { name: 'грибной суп', aliases: ['грибной суп', 'суп грибной'], source: 'skurikhin', prepared: true,
    per100: { kcal: 50, prot: 1.9, fat: 2.4, carb: 5.7, minerals: {} } },
  { name: 'суп харчо', aliases: ['харчо', 'суп харчо'], source: 'skurikhin', prepared: true,
    per100: { kcal: 75, prot: 3.1, fat: 4.5, carb: 5.5, minerals: {} } },
  { name: 'свекольник', aliases: ['свекольник', 'холодник'], source: 'skurikhin', prepared: true,
    per100: { kcal: 36, prot: 0.5, fat: 2, carb: 4.2, minerals: {} } },
  { name: 'щавелевый суп', aliases: ['щавелевый суп', 'суп из щавеля'], source: 'skurikhin', prepared: true,
    per100: { kcal: 40, prot: 1.6, fat: 2.5, carb: 2.9, minerals: {} } },
  { name: 'фасолевый суп', aliases: ['фасолевый суп', 'суп фасолевый'], source: 'skurikhin', prepared: true,
    per100: { kcal: 62, prot: 4, fat: 1.8, carb: 10, minerals: {} } },
  { name: 'куриный бульон', aliases: ['бульон', 'куриный бульон'], source: 'skurikhin', prepared: true,
    per100: { kcal: 15, prot: 2, fat: 0.5, carb: 0.3, minerals: {} } },

  // — Салаты —
  { name: 'оливье', aliases: ['оливье', 'салат оливье', 'зимний салат'], source: 'skurikhin', prepared: true,
    per100: { kcal: 115, prot: 4.6, fat: 8, carb: 5.9, minerals: {} } },
  { name: 'винегрет', aliases: ['винегрет'], source: 'skurikhin', prepared: true,
    per100: { kcal: 75, prot: 1.8, fat: 3.7, carb: 8.8, minerals: {} } },
  { name: 'селёдка под шубой', aliases: ['селёдка под шубой', 'сельдь под шубой', 'шуба'], source: 'skurikhin', prepared: true,
    per100: { kcal: 193, prot: 5.1, fat: 16.2, carb: 7.3, minerals: {} } },
  { name: 'салат мимоза', aliases: ['мимоза', 'салат мимоза'], source: 'skurikhin', prepared: true,
    per100: { kcal: 183, prot: 5.7, fat: 14.8, carb: 7.2, minerals: {} } },
  { name: 'крабовый салат', aliases: ['крабовый салат', 'салат с крабовыми палочками'], source: 'skurikhin', prepared: true,
    per100: { kcal: 128, prot: 9.2, fat: 7.4, carb: 5.9, minerals: {} } },

  // — Вторые блюда —
  { name: 'котлета', aliases: ['котлета', 'котлеты', 'котлета мясная', 'котлета говяжья'], source: 'skurikhin', prepared: true,
    per100: { kcal: 260, prot: 18, fat: 20, carb: 0, minerals: {} } },
  { name: 'котлета из индейки', aliases: ['котлета из индейки', 'котлеты индюшиные'], source: 'skurikhin', prepared: true,
    per100: { kcal: 220, prot: 18.6, fat: 12.2, carb: 8.7, minerals: {} } },
  { name: 'гуляш', aliases: ['гуляш', 'гуляш говяжий'], source: 'skurikhin', prepared: true,
    per100: { kcal: 148, prot: 14, fat: 9.2, carb: 2.6, minerals: {} } },
  { name: 'голубцы', aliases: ['голубцы', 'голубец'], source: 'skurikhin', prepared: true,
    per100: { kcal: 130, prot: 5, fat: 9, carb: 6, minerals: {} } },
  { name: 'бефстроганов', aliases: ['бефстроганов'], source: 'skurikhin', prepared: true,
    per100: { kcal: 193, prot: 16.7, fat: 11.3, carb: 5.9, minerals: {} } },
  { name: 'азу', aliases: ['азу'], source: 'skurikhin', prepared: true,
    per100: { kcal: 214, prot: 11.9, fat: 14.2, carb: 10.2, minerals: {} } },
  { name: 'сырники', aliases: ['сырники', 'сырник', 'творожники'], source: 'skurikhin', prepared: true,
    per100: { kcal: 183, prot: 18.6, fat: 3.6, carb: 18.2, minerals: {} } },

  // — Каши на молоке —
  { name: 'гречневая каша на молоке', aliases: ['гречневая каша на молоке', 'гречка с молоком'], source: 'skurikhin', prepared: true,
    per100: { kcal: 118, prot: 4.2, fat: 2.3, carb: 21.6, minerals: {} } },
  { name: 'манная каша', aliases: ['манная каша', 'манка', 'манная каша на молоке'], source: 'skurikhin', prepared: true,
    per100: { kcal: 98, prot: 3, fat: 3.2, carb: 15.3, minerals: {} } },
  { name: 'овсяная каша на молоке', aliases: ['овсяная каша на молоке', 'овсянка на молоке'], source: 'skurikhin', prepared: true,
    per100: { kcal: 102, prot: 3.2, fat: 4.1, carb: 14.2, minerals: {} } },

  // — Напитки —
  { name: 'компот из сухофруктов', aliases: ['компот', 'компот из сухофруктов'], source: 'skurikhin', prepared: true,
    per100: { kcal: 60, prot: 0.8, fat: 0, carb: 14.2, minerals: {} } },
  { name: 'кисель', aliases: ['кисель'], source: 'skurikhin', prepared: true,
    per100: { kcal: 78, prot: 0.2, fat: 0, carb: 18.9, minerals: {} } },
  // Сладкая газировка. Класс отсутствовал целиком, и на «лимонад тархун
  // черноголовка» цепочка уходила в USDA, где «тархун» матчился в СУШЁНЫЙ
  // ЭСТРАГОН (295 ккал, 22.8 г белка) — бутылка лимонада выходила на 974 ккал.
  // Названия сортов («тархун», «дюшес», «байкал», «саяны») — это травы и ягоды,
  // поэтому именно они и ловят травяные строки из англоязычных баз; держим их
  // здесь, первыми в цепочке. Бренд в запросе («черноголовка») не мешает: строка
  // берётся по названию сорта. Значения — типовая сладкая газировка; конкретный
  // продукт пользователь поправит через «Другой вариант».
  { name: 'лимонад', aliases: ['лимонад', 'газировка', 'ситро'], source: 'skurikhin', prepared: true,
    per100: { kcal: 38, prot: 0, fat: 0, carb: 9.5, minerals: {} } },
  { name: 'лимонад тархун', aliases: ['тархун', 'лимонад тархун', 'напиток тархун'], source: 'skurikhin', prepared: true,
    per100: { kcal: 35, prot: 0, fat: 0, carb: 8.7, minerals: {} } },
  { name: 'лимонад дюшес', aliases: ['дюшес', 'лимонад дюшес'], source: 'skurikhin', prepared: true,
    per100: { kcal: 38, prot: 0, fat: 0, carb: 9.4, minerals: {} } },
  { name: 'лимонад байкал', aliases: ['байкал', 'лимонад байкал'], source: 'skurikhin', prepared: true,
    per100: { kcal: 36, prot: 0, fat: 0, carb: 9, minerals: {} } },
  { name: 'лимонад саяны', aliases: ['саяны', 'лимонад саяны'], source: 'skurikhin', prepared: true,
    per100: { kcal: 37, prot: 0, fat: 0, carb: 9.2, minerals: {} } },
  { name: 'квас', aliases: ['квас', 'квас хлебный'], source: 'skurikhin', prepared: true,
    per100: { kcal: 27, prot: 0.2, fat: 0, carb: 5.2, minerals: {} } },
  { name: 'морс', aliases: ['морс', 'морс клюквенный', 'морс брусничный'], source: 'skurikhin', prepared: true,
    per100: { kcal: 41, prot: 0.1, fat: 0, carb: 10.1, minerals: {} } },

  // — Выпечка / сладкое —
  { name: 'пончик', aliases: ['пончик', 'пончики', 'пышка', 'пышки'], source: 'skurikhin', prepared: true,
    per100: { kcal: 296, prot: 5.8, fat: 13, carb: 38.8, minerals: {} } },
  { name: 'булочка', aliases: ['булочка', 'булка', 'сдоба', 'сдобная булочка'], source: 'skurikhin', prepared: true,
    per100: { kcal: 339, prot: 7.9, fat: 9.4, carb: 55.5, minerals: {} } },
  { name: 'пирожок', aliases: ['пирожок', 'пирожки'], source: 'skurikhin', prepared: true,
    per100: { kcal: 294, prot: 7.7, fat: 7, carb: 50, minerals: {} } },
  { name: 'блины', aliases: ['блины', 'блин', 'блинчик', 'блинчики'], source: 'skurikhin', prepared: true,
    per100: { kcal: 233, prot: 6.1, fat: 12.3, carb: 26, minerals: {} } },
  { name: 'оладьи', aliases: ['оладьи', 'оладья', 'оладушки'], source: 'skurikhin', prepared: true,
    per100: { kcal: 295, prot: 6.4, fat: 9, carb: 46, minerals: {} } },
  // Пельмени — deliberately NOT `prepared`: people boil or fry them at home,
  // so the cooking-method chips stay genuinely useful here.
  { name: 'пельмени', aliases: ['пельмени', 'пельмень'], source: 'skurikhin',
    per100: { kcal: 275, prot: 11.9, fat: 12.4, carb: 29, minerals: {} } },
  { name: 'печенье', aliases: ['печенье', 'печеньки'], source: 'skurikhin', prepared: true,
    per100: { kcal: 417, prot: 7.5, fat: 11.8, carb: 74.4, minerals: {} } },
];
