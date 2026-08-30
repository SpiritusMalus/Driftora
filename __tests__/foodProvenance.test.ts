import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import { draftFromStoredEntry, getFoodEntry, repeatFoodEntry, saveParsedEntry } from '@/lib/core/db/food';
import * as schema from '@/lib/core/db/schema';
import type { MealDraft } from '@/lib/core/services/foodParser';

/**
 * ПРОВЕНАНС — ЧАСТЬ ФАКТА, А НЕ УКРАШЕНИЕ ЭКРАНА. Позиция, посчитанная моделью
 * «на глаз» (±30%), при сохранении теряла своё происхождение и при следующем
 * открытии выглядела ровно как строка из USDA: бейдж «≈ оценка ИИ» смотрит на
 * источник, а источник умирал в БД. Правка граммов пересчитывала выдуманный
 * per-100 как точный, «Повторить» плодило копии без пометки.
 */

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/// Одна позиция из базы, одна — прикинутая моделью.
function mixedDraft(): MealDraft {
  return {
    region: 'RU',
    items: [
      {
        name_ru: 'курица',
        name_en: 'chicken',
        grams: 100,
        grams_source: 'confirmed' as const,
        confidence: 0.9,
        per100: { kcal: 200, prot: 20, fat: 10, carb: 0, minerals: {}, source: 'usda' as const },
        scaled: { kcal: 200, prot: 20, fat: 10, carb: 0, minerals: {} },
        approximate: false,
      },
      {
        name_ru: 'плескавица',
        name_en: 'pljeskavica',
        grams: 200,
        grams_source: 'confirmed' as const,
        confidence: 0.6,
        per100: { kcal: 230, prot: 17, fat: 16, carb: 3, minerals: {}, source: 'ai_estimate' as const },
        scaled: { kcal: 460, prot: 34, fat: 32, carb: 6, minerals: {} },
        approximate: true,
      },
    ],
    totals: { kcal: 660, prot: 54, fat: 42, carb: 6, minerals: {} },
    portion_state: 'confirmed',
    approximate: true,
    flags: { has_estimate: false, low_confidence: false },
  };
}

describe('провенанс позиции переживает сохранение', () => {
  it('открытая заново запись помнит, что состав был оценкой ИИ', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const id = await saveParsedEntry(db, { rawText: 'курица и плескавица', source: 'text', draft: mixedDraft() });

    const detail = await getFoodEntry(db, id);
    const restored = draftFromStoredEntry('RU', detail!.items);

    expect(restored.items[0].per100.source).toBe('usda'); // строка базы осталась строкой базы
    expect(restored.items[1].per100.source).toBe('ai_estimate'); // а оценка — оценкой
    expect(restored.items[1].approximate).toBe(true); // и «≈» на ней держится
    expect(restored.items[0].approximate).toBe(false); // на точной — нет
    expect(restored.totals.kcal).toBe(660); // числа при этом ровно те же
    sqlite.close();
  });

  it('«Повторить» несёт происхождение оригинала, а не отбеливает его', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const id = await saveParsedEntry(db, { rawText: 'плескавица', source: 'text', draft: mixedDraft() });

    const copyId = await repeatFoodEntry(db, id);
    const copy = await getFoodEntry(db, copyId!);
    const restored = draftFromStoredEntry('RU', copy!.items);

    expect(restored.items[1].per100.source).toBe('ai_estimate');
  });

  it('строки, записанные ДО колонки, честно неизвестны — журнал, а не база', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const id = await saveParsedEntry(db, { rawText: 'курица', source: 'text', draft: mixedDraft() });
    // Имитируем старую запись: провенанса у неё нет и взяться ему неоткуда.
    sqlite.exec('UPDATE food_items SET source = NULL');

    const detail = await getFoodEntry(db, id);
    const restored = draftFromStoredEntry('RU', detail!.items);

    expect(restored.items[0].per100.source).toBe('history');
    expect(restored.items[0].approximate).toBe(false);
    sqlite.close();
  });
});
