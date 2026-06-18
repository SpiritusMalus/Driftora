/**
 * Curated map: common Russian foods → a USDA SR Legacy lookup. NAMES ONLY — no
 * nutrition numbers live here (those come from SR Legacy at import time, so they
 * are sourced + verifiable, never fabricated). `query` words must ALL appear in
 * the SR description; `prefer` words bias the pick; `fdcId` pins an exact food
 * when fuzzy matching is ambiguous. Foods with no good SR match are omitted by
 * the importer → the resolver's honest `estimate` fallback covers them.
 *
 * Extend this list freely; re-run `npm run import:nutrition` to regenerate the
 * table. RU-specific items absent from USDA (ряженка, сырок, etc.) are left out
 * here on purpose — drop in a real Skurikhin dataset to add them.
 */
export interface RuFood {
  name: string;
  aliases: string[];
  query: string;
  prefer?: string;
  fdcId?: number;
}

export const RU_FOODS: RuFood[] = [
  // — Яйца / молочное —
  { name: 'куриное яйцо', aliases: ['яйцо', 'яйца', 'яиц'], query: 'egg whole raw fresh' },
  { name: 'яичный белок', aliases: ['белок яйца'], query: 'egg white raw fresh' },
  { name: 'яичный желток', aliases: ['желток'], query: 'egg yolk raw fresh' },
  { name: 'молоко 3.2%', aliases: ['молоко'], query: 'milk whole 3.25 milkfat', prefer: 'without added vitamin' },
  { name: 'молоко 1%', aliases: ['молоко обезжиренное'], query: 'milk lowfat 1 milkfat', prefer: 'without added vitamin' },
  { name: 'кефир', aliases: ['кефир'], query: 'kefir lowfat plain', fdcId: 170904 },
  { name: 'творог 2%', aliases: ['творог'], query: 'cheese cottage lowfat 2 milkfat' },
  { name: 'творог обезжиренный', aliases: ['творог нежирный'], query: 'cheese cottage nonfat uncreamed dry' },
  { name: 'сметана', aliases: ['сметана'], query: 'cream sour cultured' },
  { name: 'йогурт', aliases: ['йогурт'], query: 'yogurt plain whole milk' },
  { name: 'йогурт греческий', aliases: ['греческий йогурт'], query: 'yogurt greek plain whole milk' },
  { name: 'сыр российский', aliases: ['сыр', 'твёрдый сыр'], query: 'cheese cheddar', prefer: 'sharp' },
  { name: 'сыр моцарелла', aliases: ['моцарелла'], query: 'cheese mozzarella whole milk' },
  { name: 'сыр фета', aliases: ['фета', 'брынза'], query: 'cheese feta' },
  { name: 'сливочное масло', aliases: ['масло сливочное'], query: 'butter salted' },

  // — Мясо / птица —
  { name: 'куриная грудка', aliases: ['курица', 'куриное филе', 'грудка', 'кур'], query: 'chicken breast meat only cooked roasted' },
  { name: 'куриное бедро', aliases: ['бедро курицы', 'окорочок'], query: 'chicken thigh meat only cooked roasted' },
  { name: 'куриная голень', aliases: ['голень'], query: 'chicken drumstick meat only cooked roasted' },
  { name: 'индейка грудка', aliases: ['индейка'], query: 'turkey breast meat only roasted' },
  { name: 'говядина', aliases: ['говядина', 'говяжье'], query: 'beef round eye roast cooked roasted', fdcId: 168702 },
  { name: 'говяжий фарш', aliases: ['фарш', 'фарш говяжий'], query: 'ground beef 85 lean cooked pan-broiled' },
  { name: 'свинина', aliases: ['свинина', 'свиное'], query: 'pork loin lean cooked roasted' },
  { name: 'свиная отбивная', aliases: ['отбивная'], query: 'pork chop cooked' },
  { name: 'бекон', aliases: ['бекон'], query: 'bacon cooked' },
  { name: 'сосиски', aliases: ['сосиска', 'сардельки'], query: 'frankfurter beef' },
  { name: 'колбаса варёная', aliases: ['колбаса'], query: 'bologna beef' },
  { name: 'ветчина', aliases: ['ветчина'], query: 'ham sliced regular' },
  { name: 'печень говяжья', aliases: ['печень'], query: 'beef liver cooked braised' },
  { name: 'баранина', aliases: ['баранина'], query: 'lamb loin lean cooked broiled' },

  // — Рыба / морепродукты —
  { name: 'лосось', aliases: ['лосось', 'сёмга', 'семга'], query: 'fish salmon atlantic farmed cooked' },
  { name: 'горбуша', aliases: ['горбуша'], query: 'fish salmon pink cooked dry heat' },
  { name: 'тунец', aliases: ['тунец'], query: 'fish tuna light canned water drained' },
  { name: 'треска', aliases: ['треска'], query: 'fish cod atlantic cooked dry heat' },
  { name: 'минтай', aliases: ['минтай'], query: 'fish pollock alaska cooked dry heat' },
  { name: 'сельдь', aliases: ['селёдка', 'сельдь'], query: 'fish herring atlantic cooked dry heat' },
  { name: 'скумбрия', aliases: ['скумбрия'], query: 'fish mackerel atlantic cooked dry heat' },
  { name: 'креветки', aliases: ['креветка'], query: 'crustaceans shrimp cooked' },
  { name: 'кальмар', aliases: ['кальмары'], query: 'mollusks squid cooked fried' },

  // — Крупы / гарниры (варёные) —
  { name: 'гречка варёная', aliases: ['гречка', 'греча', 'гречневая'], query: 'buckwheat groats roasted cooked' },
  { name: 'рис белый варёный', aliases: ['рис', 'рис белый'], query: 'rice white long-grain regular enriched cooked' },
  { name: 'рис бурый варёный', aliases: ['бурый рис', 'коричневый рис'], query: 'rice brown long-grain cooked' },
  { name: 'овсянка на воде', aliases: ['овсянка', 'овсяная каша', 'геркулес'], query: 'oats regular quick instant water cooked' },
  { name: 'пшено варёное', aliases: ['пшено', 'пшённая'], query: 'millet cooked' },
  { name: 'перловка варёная', aliases: ['перловка', 'перловая'], query: 'barley pearled cooked' },
  { name: 'киноа варёная', aliases: ['киноа', 'квиноа'], query: 'quinoa cooked' },
  { name: 'булгур варёный', aliases: ['булгур'], query: 'bulgur cooked' },
  { name: 'кускус варёный', aliases: ['кускус'], query: 'couscous cooked' },
  { name: 'макароны варёные', aliases: ['макароны', 'паста', 'спагетти'], query: 'pasta cooked enriched without added salt' },
  { name: 'манная каша', aliases: ['манка', 'манная'], query: 'semolina enriched cooked' },

  // — Бобовые —
  { name: 'чечевица варёная', aliases: ['чечевица'], query: 'lentils mature seeds cooked boiled without salt' },
  { name: 'фасоль красная варёная', aliases: ['фасоль', 'красная фасоль'], query: 'beans kidney red mature seeds cooked boiled without salt' },
  { name: 'нут варёный', aliases: ['нут', 'турецкий горох'], query: 'chickpeas garbanzo mature seeds cooked boiled without salt' },
  { name: 'горох варёный', aliases: ['горох'], query: 'peas split mature seeds cooked boiled without salt' },
  { name: 'фасоль белая варёная', aliases: ['белая фасоль'], query: 'beans white mature seeds cooked boiled without salt' },
  { name: 'соя варёная', aliases: ['соя', 'соевые бобы'], query: 'soybeans mature seeds cooked boiled without salt' },
  { name: 'тофу', aliases: ['тофу'], query: 'tofu raw firm prepared calcium sulfate' },

  // — Хлеб / выпечка —
  { name: 'хлеб белый', aliases: ['хлеб', 'батон', 'булка', 'тост'], query: 'bread white commercially prepared' },
  { name: 'хлеб ржаной', aliases: ['ржаной хлеб', 'чёрный хлеб'], query: 'bread rye' },
  { name: 'хлеб цельнозерновой', aliases: ['цельнозерновой хлеб'], query: 'bread whole-wheat commercially prepared' },
  { name: 'лаваш', aliases: ['лаваш', 'пита'], query: 'bread pita white enriched' },
  { name: 'сухари', aliases: ['сухарь', 'гренки'], query: 'bread crumbs dry grated plain' },

  // — Овощи —
  { name: 'помидор', aliases: ['помидор', 'томат'], query: 'tomatoes red ripe raw year round average' },
  { name: 'огурец', aliases: ['огурец', 'огурцы'], query: 'cucumber with peel raw' },
  { name: 'морковь', aliases: ['морковь', 'морковка'], query: 'carrots raw' },
  { name: 'капуста белокочанная', aliases: ['капуста'], query: 'cabbage raw' },
  { name: 'капуста цветная', aliases: ['цветная капуста'], query: 'cauliflower raw' },
  { name: 'брокколи', aliases: ['брокколи'], query: 'broccoli raw' },
  { name: 'лук репчатый', aliases: ['лук'], query: 'onions raw' },
  { name: 'картофель варёный', aliases: ['картофель', 'картошка', 'пюре'], query: 'potatoes boiled cooked without skin flesh without salt' },
  { name: 'свёкла варёная', aliases: ['свёкла', 'свекла'], query: 'beets cooked boiled drained' },
  { name: 'перец болгарский', aliases: ['перец', 'болгарский перец'], query: 'peppers sweet red raw' },
  { name: 'кабачок', aliases: ['кабачок', 'цукини'], query: 'squash summer zucchini includes skin raw' },
  { name: 'баклажан', aliases: ['баклажан'], query: 'eggplant raw' },
  { name: 'тыква', aliases: ['тыква'], query: 'pumpkin raw' },
  { name: 'шпинат', aliases: ['шпинат'], query: 'spinach raw' },
  { name: 'салат листовой', aliases: ['салат', 'латук'], query: 'lettuce green leaf raw' },
  { name: 'грибы шампиньоны', aliases: ['грибы', 'шампиньоны'], query: 'mushrooms white raw' },
  { name: 'кукуруза', aliases: ['кукуруза'], query: 'corn sweet yellow cooked boiled drained without salt' },
  { name: 'горошек зелёный', aliases: ['зелёный горошек', 'горошек'], query: 'peas green raw' },
  { name: 'чеснок', aliases: ['чеснок'], query: 'garlic raw' },

  // — Фрукты / ягоды —
  { name: 'яблоко', aliases: ['яблоко', 'ябло'], query: 'apples raw with skin' },
  { name: 'банан', aliases: ['банан'], query: 'bananas raw' },
  { name: 'апельсин', aliases: ['апельсин'], query: 'oranges raw all commercial varieties' },
  { name: 'мандарин', aliases: ['мандарин'], query: 'tangerines mandarin oranges raw' },
  { name: 'груша', aliases: ['груша'], query: 'pears raw' },
  { name: 'виноград', aliases: ['виноград'], query: 'grapes red green raw' },
  { name: 'клубника', aliases: ['клубника', 'земляника'], query: 'strawberries raw' },
  { name: 'черника', aliases: ['черника', 'голубика'], query: 'blueberries raw' },
  { name: 'малина', aliases: ['малина'], query: 'raspberries raw' },
  { name: 'арбуз', aliases: ['арбуз'], query: 'watermelon raw' },
  { name: 'дыня', aliases: ['дыня'], query: 'melons cantaloupe raw' },
  { name: 'киви', aliases: ['киви'], query: 'kiwifruit green raw' },
  { name: 'ананас', aliases: ['ананас'], query: 'pineapple raw all varieties' },
  { name: 'персик', aliases: ['персик'], query: 'peaches raw' },
  { name: 'слива', aliases: ['слива'], query: 'plums raw' },
  { name: 'лимон', aliases: ['лимон'], query: 'lemons raw without peel' },
  { name: 'грейпфрут', aliases: ['грейпфрут'], query: 'grapefruit raw pink red white all areas' },
  { name: 'авокадо', aliases: ['авокадо'], query: 'avocados raw all commercial varieties' },
  { name: 'хурма', aliases: ['хурма'], query: 'persimmons japanese raw' },
  { name: 'гранат', aliases: ['гранат'], query: 'pomegranates raw', fdcId: 169134 },

  // — Орехи / семена —
  { name: 'грецкий орех', aliases: ['грецкий орех', 'грецкие орехи'], query: 'nuts walnuts english' },
  { name: 'миндаль', aliases: ['миндаль'], query: 'nuts almonds' },
  { name: 'фундук', aliases: ['фундук', 'лесной орех'], query: 'nuts hazelnuts filberts' },
  { name: 'кешью', aliases: ['кешью'], query: 'nuts cashew nuts raw' },
  { name: 'арахис', aliases: ['арахис'], query: 'peanuts all types raw' },
  { name: 'фисташки', aliases: ['фисташки'], query: 'nuts pistachio nuts raw' },
  { name: 'семечки подсолнечника', aliases: ['семечки', 'подсолнечник'], query: 'seeds sunflower seed kernels dried' },
  { name: 'тыквенные семечки', aliases: ['тыквенные семечки'], query: 'seeds pumpkin squash seed kernels dried' },
  { name: 'арахисовая паста', aliases: ['арахисовая паста', 'арахисовое масло'], query: 'peanut butter smooth' },

  // — Жиры / масла —
  { name: 'подсолнечное масло', aliases: ['растительное масло', 'подсолнечное масло'], query: 'oil sunflower' },
  { name: 'оливковое масло', aliases: ['оливковое масло'], query: 'oil olive salad or cooking' },

  // — Сладкое —
  { name: 'сахар', aliases: ['сахар'], query: 'sugars granulated' },
  { name: 'мёд', aliases: ['мёд', 'мед'], query: 'honey' },
  { name: 'шоколад молочный', aliases: ['шоколад', 'молочный шоколад'], query: 'candies milk chocolate' },
  { name: 'шоколад тёмный', aliases: ['тёмный шоколад', 'горький шоколад'], query: 'candies dark chocolate 70 85 cacao solids' },
  { name: 'джем', aliases: ['джем', 'варенье'], query: 'jams and preserves' },
  { name: 'мороженое', aliases: ['мороженое'], query: 'ice creams vanilla', fdcId: 167575 },

  // — Напитки —
  { name: 'кофе чёрный', aliases: ['кофе', 'эспрессо'], query: 'beverages coffee brewed prepared tap water' },
  { name: 'чай чёрный', aliases: ['чай'], query: 'beverages tea black brewed prepared tap water' },
  { name: 'апельсиновый сок', aliases: ['апельсиновый сок', 'сок'], query: 'orange juice raw' },
  { name: 'яблочный сок', aliases: ['яблочный сок'], query: 'apple juice canned bottled unsweetened' },
];
