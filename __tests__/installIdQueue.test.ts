import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureInstallId } from '@/lib/core/services/installId';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

async function storedId(db: ReturnType<typeof makeDb>['db']): Promise<string | null> {
  const rows = await db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 0));
  return (rows[0]?.installId as string | null) ?? null;
}

describe('install id', () => {
  it('mints exactly one id when two callers race', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const [a, b] = await Promise.all([ensureInstallId(db), ensureInstallId(db)]);

    expect(a).toBe(b);
    expect(await storedId(db)).toBe(a);
    sqlite.close();
  });
});
