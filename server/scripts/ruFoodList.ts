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
  { name: 'яйцо варёное', aliases: ['варёное яйцо', 'яйцо вкрутую'], query: 'egg whole cooked hard-boiled' },
  { name: 'омлет', aliases: ['омлет'], query: 'egg whole cooked omelet' },
  { name: 'яичница', aliases: ['яичница', 'глазунья'], query: 'egg whole cooked fried' },
  { name: 'сливки 10%', aliases: ['сливки'], query: 'cream fluid half and half' },
  { name: 'сливки 20%', aliases: ['сливки 20'], query: 'cream fluid light coffee cream' },
  { name: 'сыр плавленый', aliases: ['плавленый сыр', 'плавленный сыр'], query: 'cheese pasteurized process american', prefer: 'fortified vitamin d' },
  { name: 'сыр пармезан', aliases: ['пармезан'], query: 'cheese parmesan grated' },
  { name: 'сыр сливочный', aliases: ['сливочный сыр', 'творожный сыр'], query: 'cheese cream' },
  { name: 'сгущёнка', aliases: ['сгущённое молоко', 'сгущенка'], query: 'milk canned condensed sweetened' },
  { name: 'сметана', aliases: ['сметана'], query: 'cream sour cultured' },
  { name: 'йогурт', aliases: ['йогурт'], query: 'yogurt plain whole milk' },
  { name: 'йогурт греческий', aliases: ['греческий йогурт'], query: 'yogurt greek plain whole milk' },
  { name: 'сыр российский', aliases: ['сыр', 'твёрдый сыр'], query: 'cheese cheddar', prefer: 'sharp' },
  { name: 'сыр моцарелла', aliases: ['моцарелла'], query: 'cheese mozzarella whole milk' },
  { name: 'сыр фета', aliases: ['фета', 'брынза'], query: 'cheese feta' },
  { name: 'сливочное масло', aliases: ['масло сливочное'], query: 'butter salted' },

  // — Мясо / птица —
  // TRANSPARENCY: SR rows here are COOKED — the RU name must say so (the card
  // shows the matched row's name; a stateless «куриная грудка» would silently
  // present roasted-breast numbers as if they were raw). The plain name stays
  // an alias, so «курица»/«грудка» still match exactly.
  { name: 'куриная грудка запечённая', aliases: ['куриная грудка', 'курица', 'куриное филе', 'грудка', 'кур'], query: 'chicken breast meat only cooked roasted' },
  { name: 'куриное бедро запечённое', aliases: ['куриное бедро', 'бедро курицы', 'окорочок'], query: 'chicken thigh meat only cooked roasted' },
  { name: 'куриная голень запечённая', aliases: ['куриная голень', 'голень'], query: 'chicken drumstick meat only cooked roasted' },
  { name: 'грудка индейки запечённая', aliases: ['индейка', 'индейка грудка'], query: 'turkey breast meat only roasted' },
  { name: 'говядина запечённая', aliases: ['говядина', 'говяжье'], query: 'beef round eye roast cooked roasted', fdcId: 168702 },
  { name: 'говяжий фарш жареный', aliases: ['говяжий фарш', 'фарш', 'фарш говяжий'], query: 'ground beef 85 lean cooked pan-broiled' },
  { name: 'свинина запечённая', aliases: ['свинина', 'свиное'], query: 'pork loin lean cooked roasted' },
  { name: 'свиная отбивная', aliases: ['отбивная'], query: 'pork chop cooked' },
  { name: 'бекон жареный', aliases: ['бекон'], query: 'bacon cooked' },
  { name: 'сосиски', aliases: ['сосиска', 'сардельки'], query: 'frankfurter beef' },
  { name: 'колбаса варёная', aliases: ['колбаса'], query: 'bologna beef' },
  { name: 'ветчина', aliases: ['ветчина'], query: 'ham sliced regular' },
  { name: 'печень говяжья тушёная', aliases: ['печень говяжья', 'печень'], query: 'beef liver cooked braised' },
  { name: 'баранина гриль', aliases: ['баранина'], query: 'lamb loin lean cooked broiled' },
  { name: 'курица жареная', aliases: ['жареная курица', 'курица гриль'], query: 'chicken broilers or fryers meat and skin cooked roasted' },
  { name: 'утка запечённая', aliases: ['утка', 'утиная грудка'], query: 'duck domesticated meat only cooked roasted' },
  { name: 'кролик запечённый', aliases: ['кролик', 'крольчатина'], query: 'game meat rabbit domesticated cooked roasted' },
  { name: 'печень куриная отварная', aliases: ['печень куриная', 'куриная печень', 'печёнка куриная'], query: 'chicken liver all classes cooked simmered' },
  { name: 'язык говяжий отварной', aliases: ['язык говяжий', 'язык', 'говяжий язык'], query: 'beef tongue cooked simmered' },
  { name: 'сало', aliases: ['сало', 'шпик'], query: 'pork fresh backfat raw' },

  // — Рыба / морепродукты —
  // Same transparency rule: SR fish rows are cooked (dry heat ≈ запечённая) or
  // canned — the RU name says so, the plain name stays an alias.
  { name: 'лосось запечённый', aliases: ['лосось', 'сёмга', 'семга'], query: 'fish salmon atlantic farmed cooked' },
  { name: 'горбуша запечённая', aliases: ['горбуша'], query: 'fish salmon pink cooked dry heat' },
  { name: 'тунец консервированный', aliases: ['тунец'], query: 'fish tuna light canned water drained' },
  { name: 'треска запечённая', aliases: ['треска'], query: 'fish cod atlantic cooked dry heat' },
  { name: 'минтай запечённый', aliases: ['минтай'], query: 'fish pollock alaska cooked dry heat' },
  { name: 'сельдь запечённая', aliases: ['селёдка', 'сельдь'], query: 'fish herring atlantic cooked dry heat' },
  { name: 'скумбрия запечённая', aliases: ['скумбрия'], query: 'fish mackerel atlantic cooked dry heat' },
  { name: 'креветки варёные', aliases: ['креветки', 'креветка'], query: 'crustaceans shrimp cooked' },
  { name: 'кальмар жареный', aliases: ['кальмар', 'кальмары'], query: 'mollusks squid cooked fried' },
  { name: 'форель запечённая', aliases: ['форель'], query: 'fish trout rainbow farmed cooked dry heat' },
  { name: 'судак запечённый', aliases: ['судак'], query: 'fish pike walleye cooked dry heat' },
  { name: 'щука запечённая', aliases: ['щука'], query: 'fish pike northern cooked dry heat' },
  { name: 'карп запечённый', aliases: ['карп'], query: 'fish carp cooked dry heat' },
  { name: 'окунь запечённый', aliases: ['окунь'], query: 'fish perch mixed species cooked dry heat' },
  { name: 'камбала запечённая', aliases: ['камбала'], query: 'fish flatfish flounder and sole species cooked dry heat' },
  { name: 'икра красная', aliases: ['икра', 'красная икра', 'икра лосося'], query: 'fish caviar black and red granular' },
  { name: 'крабовые палочки', aliases: ['крабовые палочки', 'сурими'], query: 'fish surimi' },
  { name: 'мидии варёные', aliases: ['мидии', 'мидия'], query: 'mollusks mussel blue cooked moist heat' },
  { name: 'морская капуста', aliases: ['морская капуста', 'ламинария'], query: 'seaweed kelp raw' },

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

  // — Бобовые —
  { name: 'чечевица варёная', aliases: ['чечевица'], query: 'lentils mature seeds cooked boiled without salt' },
  { name: 'фасоль красная варёная', aliases: ['фасоль', 'красная фасоль'], query: 'beans kidney red mature seeds cooked boiled without salt' },
  { name: 'нут варёный', aliases: ['нут', 'турецкий горох'], query: 'chickpeas garbanzo mature seeds cooked boiled without salt' },
  { name: 'горох варёный', aliases: ['горох'], query: 'peas split mature seeds cooked boiled without salt' },
  { name: 'фасоль белая варёная', aliases: ['белая фасоль'], query: 'beans white mature seeds cooked boiled without salt' },
  { name: 'соя варёная', aliases: ['соя', 'соевые бобы'], query: 'soybeans mature seeds cooked boiled without salt' },
  { name: 'тофу', aliases: ['тофу'], query: 'tofu raw firm prepared calcium sulfate' },

  // — Хлеб / выпечка —
  { name: 'хлеб белый', aliases: ['хлеб', 'батон', 'булка', 'тост'], query: 'bread white commercially prepared', prefer: 'soft' },
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
  { name: 'картофель варёный', aliases: ['картофель', 'картошка'], query: 'potatoes boiled cooked without skin flesh without salt' },
  { name: 'свёкла варёная', aliases: ['свёкла', 'свекла'], query: 'beets cooked boiled drained' },
  { name: 'перец болгарский', aliases: ['перец', 'болгарский перец'], query: 'peppers sweet red raw' },
  { name: 'кабачок', aliases: ['кабачок', 'цукини'], query: 'squash summer zucchini includes skin raw' },
  { name: 'баклажан', aliases: ['баклажан'], query: 'eggplant raw' },
  { name: 'тыква', aliases: ['тыква'], query: 'pumpkin raw' },
  { name: 'шпинат', aliases: ['шпинат'], query: 'spinach raw' },
  { name: 'салат листовой', aliases: ['салат', 'латук'], query: 'lettuce green leaf raw' },
  { name: 'грибы шампиньоны', aliases: ['грибы', 'шампиньоны'], query: 'mushrooms white raw' },
  { name: 'кукуруза варёная', aliases: ['кукуруза'], query: 'corn sweet yellow cooked boiled drained without salt' },
  { name: 'горошек зелёный', aliases: ['зелёный горошек', 'горошек'], query: 'peas green raw' },
  { name: 'чеснок', aliases: ['чеснок'], query: 'garlic raw' },
  { name: 'квашеная капуста', aliases: ['квашеная капуста', 'капуста квашеная'], query: 'sauerkraut canned solids and liquids' },
  { name: 'солёный огурец', aliases: ['солёные огурцы', 'маринованные огурцы', 'корнишоны'], query: 'pickles cucumber dill' },
  { name: 'оливки', aliases: ['оливки', 'маслины'], query: 'olives ripe canned small extra large' },
  { name: 'зелёный лук', aliases: ['зелёный лук', 'лук зелёный'], query: 'onions spring or scallions' },
  { name: 'укроп', aliases: ['укроп'], query: 'dill weed fresh' },
  { name: 'петрушка', aliases: ['петрушка'], query: 'parsley fresh' },
  { name: 'сельдерей', aliases: ['сельдерей'], query: 'celery raw' },
  { name: 'редис', aliases: ['редис', 'редиска'], query: 'radishes raw' },
  { name: 'репа', aliases: ['репа'], query: 'turnips raw' },
  { name: 'пекинская капуста', aliases: ['пекинская капуста'], query: 'cabbage chinese pe-tsai raw' },
  { name: 'краснокочанная капуста', aliases: ['красная капуста'], query: 'cabbage red raw' },
  { name: 'брюссельская капуста варёная', aliases: ['брюссельская капуста'], query: 'brussels sprouts cooked boiled drained', prefer: 'without salt' },
  { name: 'стручковая фасоль варёная', aliases: ['стручковая фасоль', 'зелёная фасоль'], query: 'beans snap green cooked boiled drained without salt' },
  { name: 'имбирь', aliases: ['имбирь'], query: 'ginger root raw' },
  { name: 'картофель запечённый', aliases: ['запечённый картофель', 'печёная картошка'], query: 'potatoes baked flesh and skin without salt' },
  { name: 'картофель фри', aliases: ['фри'], query: 'potatoes french fried', fdcId: 169264 },
  { name: 'драники', aliases: ['драники', 'деруны', 'картофельные оладьи'], query: 'potatoes hash brown home-prepared' },
  { name: 'картофельное пюре', aliases: ['пюре', 'пюре картофельное'], query: 'potatoes mashed home-prepared whole milk and butter' },
  { name: 'вешенки', aliases: ['вешенки'], query: 'mushrooms oyster raw' },
  { name: 'лисички', aliases: ['лисички'], query: 'mushrooms chanterelle raw' },

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
  { name: 'вишня', aliases: ['вишня'], query: 'cherries sour red raw' },
  { name: 'черешня', aliases: ['черешня'], query: 'cherries sweet raw' },
  { name: 'смородина чёрная', aliases: ['чёрная смородина', 'смородина'], query: 'currants european black raw' },
  { name: 'смородина красная', aliases: ['красная смородина'], query: 'currants red and white raw' },
  { name: 'крыжовник', aliases: ['крыжовник'], query: 'gooseberries raw' },
  { name: 'клюква', aliases: ['клюква'], query: 'cranberries raw' },
  { name: 'ежевика', aliases: ['ежевика'], query: 'blackberries raw' },
  { name: 'абрикос', aliases: ['абрикос'], query: 'apricots raw' },
  { name: 'нектарин', aliases: ['нектарин'], query: 'nectarines raw' },
  { name: 'манго', aliases: ['манго'], query: 'mangos raw' },
  { name: 'инжир', aliases: ['инжир'], query: 'figs raw' },
  { name: 'изюм', aliases: ['изюм'], query: 'raisins seedless' },
  { name: 'курага', aliases: ['курага'], query: 'apricots dried sulfured uncooked' },
  { name: 'чернослив', aliases: ['чернослив'], query: 'plums dried prunes uncooked' },
  { name: 'финики', aliases: ['финик'], query: 'dates medjool' },

  // — Орехи / семена —
  { name: 'грецкий орех', aliases: ['грецкий орех', 'грецкие орехи'], query: 'nuts walnuts english' },
  { name: 'миндаль', aliases: ['миндаль'], query: 'nuts almonds' },
  { name: 'фундук', aliases: ['фундук', 'лесной орех'], query: 'nuts hazelnuts filberts' },
  { name: 'кешью', aliases: ['кешью'], query: 'nuts cashew nuts raw' },
  { name: 'арахис', aliases: ['арахис'], query: 'peanuts all types raw' },
  { name: 'фисташки', aliases: ['фисташки'], query: 'nuts pistachio nuts raw' },
  { name: 'семечки подсолнечника', aliases: ['семечки', 'подсолнечник'], query: 'seeds sunflower seed kernels dried' },
  { name: 'тыквенные семечки', aliases: ['тыквенные семечки'], query: 'seeds pumpkin squash seed kernels dried' },
  { name: 'арахисовая паста', aliases: ['арахисовая паста', 'арахисовое масло'], query: 'peanut butter smooth', prefer: 'style without salt' },
  { name: 'семена чиа', aliases: ['чиа'], query: 'seeds chia seeds dried' },
  { name: 'семена льна', aliases: ['лён', 'льняное семя'], query: 'seeds flaxseed' },
  { name: 'кунжут', aliases: ['кунжут'], query: 'seeds sesame seeds whole dried' },

  // — Жиры / масла —
  { name: 'подсолнечное масло', aliases: ['растительное масло', 'подсолнечное масло'], query: 'oil sunflower' },
  { name: 'оливковое масло', aliases: ['оливковое масло'], query: 'oil olive salad or cooking' },
  { name: 'топлёное масло', aliases: ['топлёное масло', 'масло гхи'], query: 'butter oil anhydrous' },
  { name: 'майонез', aliases: ['майонез'], query: 'salad dressing mayonnaise regular' },
  { name: 'кетчуп', aliases: ['кетчуп'], query: 'catsup' },
  { name: 'горчица', aliases: ['горчица'], query: 'mustard prepared yellow' },
  { name: 'соевый соус', aliases: ['соевый соус'], query: 'soy sauce made from soy and wheat shoyu' },
  { name: 'томатная паста', aliases: ['томатная паста'], query: 'tomato products canned paste', prefer: 'without salt' },
  { name: 'хумус', aliases: ['хумус'], query: 'hummus commercial' },

  // — Сладкое —
  { name: 'сахар', aliases: ['сахар'], query: 'sugars granulated' },
  { name: 'мёд', aliases: ['мёд', 'мед'], query: 'honey' },
  { name: 'шоколад молочный', aliases: ['шоколад', 'молочный шоколад'], query: 'candies milk chocolate' },
  { name: 'шоколад тёмный', aliases: ['тёмный шоколад', 'горький шоколад'], query: 'candies dark chocolate 70 85 cacao solids' },
  { name: 'джем', aliases: ['джем', 'варенье'], query: 'jams and preserves' },
  { name: 'мороженое', aliases: ['мороженое'], query: 'ice creams vanilla', fdcId: 167575 },
  { name: 'халва', aliases: ['халва'], query: 'candies halavah plain' },
  { name: 'вафли', aliases: ['вафля'], query: 'cookies sugar wafers with creme filling', prefer: 'regular' },
  { name: 'овсяное печенье', aliases: ['овсяное печенье'], query: 'cookies oatmeal commercially prepared regular' },
  { name: 'крекер', aliases: ['крекеры', 'галеты'], query: 'crackers saltines', prefer: 'includes oyster soda soup' },
  { name: 'какао-порошок', aliases: ['какао'], query: 'cocoa dry powder unsweetened' },
  { name: 'мюсли', aliases: ['мюсли', 'гранола'], query: 'granola homemade' },

  // — Напитки —
  { name: 'кофе чёрный', aliases: ['кофе', 'эспрессо'], query: 'beverages coffee brewed prepared tap water' },
  { name: 'чай чёрный', aliases: ['чай'], query: 'beverages tea black brewed prepared tap water' },
  { name: 'апельсиновый сок', aliases: ['апельсиновый сок', 'сок'], query: 'orange juice raw' },
  { name: 'яблочный сок', aliases: ['яблочный сок'], query: 'apple juice canned bottled unsweetened' },
  { name: 'кола', aliases: ['кола', 'газировка'], query: 'carbonated beverage cola', fdcId: 174852 },
  { name: 'пиво', aliases: ['пиво'], query: 'alcoholic beverage beer regular all' },
  { name: 'вино красное сухое', aliases: ['вино', 'красное вино'], query: 'alcoholic beverage wine table red' },
  { name: 'вино белое сухое', aliases: ['белое вино'], query: 'alcoholic beverage wine table white' },
  { name: 'водка', aliases: ['водка'], query: 'alcoholic beverage distilled all 80 proof' },

  // — Прочее / кулинарная база —
  { name: 'мука пшеничная', aliases: ['мука'], query: 'wheat flour white all-purpose enriched bleached' },
  { name: 'крахмал кукурузный', aliases: ['крахмал'], query: 'cornstarch' },
  { name: 'рис круглозёрный варёный', aliases: ['круглый рис'], query: 'rice white short-grain cooked' },
  { name: 'макароны цельнозерновые варёные', aliases: ['цельнозерновые макароны'], query: 'pasta whole-wheat cooked' },
];
