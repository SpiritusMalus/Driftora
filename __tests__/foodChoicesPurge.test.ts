import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { listFoodChoices, rememberFoodChoice } from '@/lib/core/db/foodChoices';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';

/// Кесадилья-баг (2026-08-21): quick-pick echoes were remembered with the
/// WHOLE MEAL's КБЖУ as per-100g under source 'history'. Those rows must be
/// invisible to «Из моего рациона» — and physically deleted on first read, so
/// an already-poisoned device heals on its next visit to the log screen.
describe('listFoodChoices purges poisoned history rows', () => {
  it('hides source:history rows, deletes them, keeps real journal rows', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((s) => sqlite.exec(s));

    // A real correction (true per-100g) and a poisoned meal echo.
    await rememberFoodChoice(db, 'RU', 'творог', {
      name: 'творог 5%',
      per100: { source: 'skurikhin', kcal: 121, prot: 17, fat: 5, carb: 1.8, minerals: {} },
    });
    await rememberFoodChoice(db, 'RU', 'кесадилья', {
      name: 'Кесадилья',
      per100: { source: 'history', kcal: 900, prot: 40, fat: 45, carb: 80, minerals: {} },
    });

    const listed = await listFoodChoices(db, 'RU');
    expect(listed.map((f) => f.name)).toEqual(['творог 5%']);

    // The poisoned row is gone from storage, not merely filtered.
    const left = await db.select().from(schema.foodChoices);
    expect(left).toHaveLength(1);
    expect(left[0].name).toBe('творог 5%');
    sqlite.close();
  });
});
