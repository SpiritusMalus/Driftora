import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { listFoodChoices, loadRememberedChoices, rememberFoodChoice } from '@/lib/core/db/foodChoices';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import {
  applyRememberedChoices,
  choiceKey,
  displayItemName,
  normalizeChoiceName,
} from '@/lib/core/services/foodChoice';
import type { MealDraft, NutritionItem, Per100 } from '@/lib/core/services/foodParser';

function per100(kcal: number, source: Per100['source'] = 'fatsecret'): Per100 {
  return { kcal, prot: 10, fat: 1, carb: 2, minerals: {}, source };
}

function item(over: Partial<NutritionItem> = {}): NutritionItem {
  return {
    name_ru: 'творог',
    name_en: 'cottage cheese',
    grams: 200,
    grams_source: 'estimated',
    confidence: 0.4,
    per100: per100(150),
    scaled: { kcal: 300, prot: 20, fat: 2, carb: 4, minerals: {} },
    approximate: true,
    ...over,
  };
}

function draft(items: NutritionItem[]): MealDraft {
  return {
    region: 'RU',
    items,
    totals: { kcal: 0, prot: 0, fat: 0, carb: 0, minerals: {} },
    portion_state: 'estimated',
    approximate: true,
    flags: { has_estimate: false, low_confidence: true },
  };
}

describe('choice keying', () => {
  it('normalizes case, ё and whitespace', () => {
    expect(normalizeChoiceName('  Творог   Обезжиренный ')).toBe('творог обезжиренный');
    expect(normalizeChoiceName('Тёмный шоколад')).toBe('темный шоколад');
  });
  it('keys by region + normalized name', () => {
    expect(choiceKey('RU', 'Творог')).toBe('RU::творог');
    expect(choiceKey('US', 'Rice')).toBe('US::rice');
  });
});

describe('displayItemName (real name after re-pick, raw words otherwise)', () => {
  it('keeps the user words when nothing was explicitly chosen', () => {
    expect(displayItemName(item({ matched_name: 'Творог 5%' }), 'RU')).toBe('творог');
  });
  it('uses the chosen DB row name once the user re-picked (userChosen)', () => {
    expect(displayItemName(item({ matched_name: 'Творог 5%', userChosen: true }), 'RU')).toBe('Творог 5%');
  });
  it('falls back to the user words when re-picked but no matched name', () => {
    expect(displayItemName(item({ userChosen: true, matched_name: undefined }), 'RU')).toBe('творог');
  });
  it('is region-aware (US → English name) when not re-picked', () => {
    expect(displayItemName(item(), 'US')).toBe('cottage cheese');
  });
});

describe('applyRememberedChoices', () => {
  it('swaps a matching item to the remembered per100 and recomputes', () => {
    const choices = new Map([[choiceKey('RU', 'творог'), { name: 'Творог 5%', per100: per100(121) }]]);
    const next = applyRememberedChoices(draft([item()]), 'RU', choices);
    const it = next.items[0]!;
    expect(it.per100.kcal).toBe(121);
    expect(it.scaled.kcal).toBe(242); // 121 * 200 / 100
    expect(it.confidence).toBe(1);
    expect(next.totals.kcal).toBe(242);
  });

  it('leaves non-matching items untouched', () => {
    const choices = new Map([[choiceKey('RU', 'банан'), { name: 'Банан', per100: per100(89) }]]);
    const next = applyRememberedChoices(draft([item()]), 'RU', choices);
    expect(next.items[0]!.per100.kcal).toBe(150);
  });

  it('stamps the remembered row name (transparency: whose numbers these are)', () => {
    const choices = new Map([[choiceKey('RU', 'творог'), { name: 'Творог 5%', per100: per100(121) }]]);
    const next = applyRememberedChoices(draft([item()]), 'RU', choices);
    expect(next.items[0]!.matched_name).toBe('Творог 5%');
  });

  it('is a no-op with an empty choice map', () => {
    const d = draft([item()]);
    expect(applyRememberedChoices(d, 'RU', new Map())).toBe(d);
  });
});

describe('foodChoices persistence (round-trip)', () => {
  function makeDb() {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    return { sqlite, db };
  }

  it('remembers a choice and loads it back for the same food', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await rememberFoodChoice(db, 'RU', 'творог', { name: 'Творог 5%', per100: per100(121) });
    const loaded = await loadRememberedChoices(db, 'RU', draft([item()]));

    const got = loaded.get(choiceKey('RU', 'творог'));
    expect(got?.per100.kcal).toBe(121);
    expect(got?.per100.source).toBe('fatsecret');
    sqlite.close();
  });

  it('upserts: the latest choice for a food wins', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await rememberFoodChoice(db, 'RU', 'творог', { name: 'Творог 5%', per100: per100(121) });
    await rememberFoodChoice(db, 'RU', 'Творог', { name: 'Творог 9%', per100: per100(159) });
    const rows = await db.select().from(schema.foodChoices);
    expect(rows).toHaveLength(1); // same key → one row
    expect(JSON.parse(rows[0]!.per100).kcal).toBe(159);
    sqlite.close();
  });

  it('end-to-end: remembered choice re-applies to a fresh parse of the same food', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    await rememberFoodChoice(db, 'RU', 'творог', { name: 'Творог 5%', per100: per100(121) });
    const fresh = draft([item()]); // parser's auto-pick (150)
    const applied = applyRememberedChoices(fresh, 'RU', await loadRememberedChoices(db, 'RU', fresh));
    expect(applied.items[0]!.per100.kcal).toBe(121);
    sqlite.close();
  });
});

describe('listFoodChoices (the «рацион»: pick a known food + type grams)', () => {
  function makeDb() {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    return { sqlite, db };
  }
  // Insert directly so ts (recency order) is deterministic — rememberFoodChoice
  // stamps `new Date()`, which can't disambiguate same-millisecond inserts.
  async function seed(db: ReturnType<typeof makeDb>['db'], key: string, name: string, kcal: number, ts: number) {
    await db.insert(schema.foodChoices).values({ key, name, per100: JSON.stringify(per100(kcal)), ts: new Date(ts) });
  }

  it('lists this region only, most-recently-used first', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    await seed(db, 'RU::курица', 'Куриная грудка', 113, 1000);
    await seed(db, 'RU::рис', 'Рис отварной', 116, 3000);
    await seed(db, 'US::rice', 'White rice', 130, 5000); // other region — excluded
    const list = await listFoodChoices(db, 'RU');
    expect(list.map((f) => f.name)).toEqual(['Рис отварной', 'Куриная грудка']);
    expect(list[0]!.per100.kcal).toBe(116);
    sqlite.close();
  });

  it('dedupes by normalized name (same food remembered under two keys shows once)', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    // «скир» typed then re-picked as «Скир натуральный» leaves two keys, one name.
    await seed(db, 'RU::скир', 'Скир натуральный', 90, 1000);
    await seed(db, 'RU::скир натуральный', 'Скир натуральный', 90, 2000);
    const list = await listFoodChoices(db, 'RU');
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Скир натуральный');
    sqlite.close();
  });

  it('caps the list at the limit', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));
    for (let i = 0; i < 30; i++) await seed(db, `RU::food${i}`, `Food ${i}`, 100 + i, 1000 + i);
    const list = await listFoodChoices(db, 'RU', 5);
    expect(list).toHaveLength(5);
    sqlite.close();
  });
});
