import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { getTableName, is, Table } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  backupTableNames,
  BACKUP_FORMAT_VERSION,
  exportAllTables,
  importAllTables,
  type BackupDocument,
} from '@/lib/core/db/backup';
import { saveDiaryEntry } from '@/lib/core/db/diary';
import { logMood } from '@/lib/core/db/mood';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { addWin, updateSettings } from '@/lib/core/db/settings';
import { upsertSleep } from '@/lib/core/db/sleep';
import { upsertSteps } from '@/lib/core/db/steps';
import { upsertWeight } from '@/lib/core/db/weight';
import { addWorkout } from '@/lib/core/db/workouts';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/// Inserts at least one row into every app table so the round-trip exercises all
/// of them. Returns nothing — the caller exports afterwards.
async function seed(db: ReturnType<typeof makeDb>['db']) {
  // Insert food rows directly (the parser's MealDraft shape is irrelevant here —
  // we only need a parent row + a child row so the FK ordering is exercised).
  const inserted = await db
    .insert(schema.foodEntries)
    .values({
      ts: new Date(2026, 5, 18, 9),
      rawText: 'омлет из трёх яиц',
      source: 'text',
      kcal: 220,
      proteinG: 19,
      fatG: 15,
      carbG: 2,
      confirmed: true,
    })
    .returning({ id: schema.foodEntries.id });
  await db.insert(schema.foodItems).values({
    entryId: inserted[0].id as number,
    name: 'яйцо',
    qtyG: 150,
    kcal: 220,
    proteinG: 19,
    fatG: 15,
    carbG: 2,
  });
  await db.insert(schema.foodChoices).values({
    key: 'RU::творог',
    name: 'Творог 5%',
    per100: JSON.stringify({ source: 'fatsecret', kcal: 121, prot: 17, fat: 5, carb: 3, minerals: {} }),
    ts: new Date(2026, 5, 18, 9),
  });
  await upsertSteps(db, '2026-06-18', 8123);
  await upsertSleep(db, '2026-06-18', 450);
  await addWorkout(db, 'run', 30, 71.4, null, new Date(2026, 5, 18, 18));
  await db.insert(schema.workoutImportTombstones).values({
    externalId: 'hk-deleted-session',
    deletedAt: new Date(2026, 5, 18, 19),
  });
  await db.insert(schema.healthDays).values({
    date: '2026-06-18',
    restingBpm: 54,
    hrvMs: 48.5,
    hrvMethod: 'rmssd',
    syncedAt: new Date(2026, 5, 18, 9),
  });
  await upsertWeight(db, '2026-06-18', 71.4);
  await logMood(db, 7);
  await saveDiaryEntry(db, {
    situation: 'meeting',
    thoughts: 'I failed',
    emotions: [{ name: 'anxiety', intensity: 70 }],
    reactionBody: 'tense',
    reactionBehavior: 'left',
    evidenceFor: 'x',
    evidenceAgainst: 'y',
    reframe: 'one setback',
    mood: 6,
    distortions: ['catastrophizing'],
  });
  await addWin(db, 'manual', 'walked 8000 steps');
  await updateSettings(db, { targetKcal: 2100, stepsGoal: 6500, hideCalories: true });
}

/// Reads every table directly (raw SQL) for an order-independent comparison.
function dumpAll(sqlite: BetterSqlite3.Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of backupTableNames()) {
    out[t] = sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  return out;
}

describe('DB backup (exportAllTables / importAllTables)', () => {
  it('round-trips every table: seed → export → wipe → import → deep-equal', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);

    const before = dumpAll(a.sqlite);
    // Sanity: every table actually has at least one row to round-trip.
    for (const t of backupTableNames()) {
      expect((before[t] as unknown[]).length).toBeGreaterThan(0);
    }

    const doc = await exportAllTables(a.db);
    expect(doc.app).toBe('driftora');
    expect(doc.formatVersion).toBe(BACKUP_FORMAT_VERSION);

    // Fresh, empty DB — simulate a new install / wiped device.
    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    // ensureSettings inserts a default row; importAllTables must clear it first
    // so the imported settings row replaces (not duplicates) it.
    await updateSettings(b.db, {});
    await importAllTables(b.db, doc);

    const after = dumpAll(b.sqlite);
    expect(after).toEqual(before);

    a.sqlite.close();
    b.sqlite.close();
  });

  it('import is idempotent (replace-all): importing twice yields the same state', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const doc = await exportAllTables(a.db);

    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    await importAllTables(b.db, doc);
    const once = dumpAll(b.sqlite);
    await importAllTables(b.db, doc);
    const twice = dumpAll(b.sqlite);
    expect(twice).toEqual(once);

    a.sqlite.close();
    b.sqlite.close();
  });

  it('covers exactly the app data tables declared by the Drizzle schema (drift guard)', () => {
    const declared = (Object.values(schema) as unknown[])
      .filter((v): v is Table => is(v, Table))
      .map((t) => getTableName(t))
      .sort();
    const exported = [...backupTableNames()].sort();
    expect(exported).toEqual(declared);
  });

  it('rejects a foreign or mis-versioned document', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));

    const wrongApp = { app: 'other', formatVersion: 1, exportedAt: '', tables: {} } as unknown as BackupDocument;
    await expect(importAllTables(a.db, wrongApp)).rejects.toThrow();

    const wrongVersion = {
      app: 'driftora',
      formatVersion: 999,
      exportedAt: '',
      tables: {},
    } as unknown as BackupDocument;
    await expect(importAllTables(a.db, wrongVersion)).rejects.toThrow();

    a.sqlite.close();
  });

  it('a failed import rolls back, leaving prior data intact (transactional)', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const good = await exportAllTables(a.db);
    const before = dumpAll(a.sqlite);

    // Corrupt the document so an insert fails mid-transaction: a food_items row
    // referencing a non-existent entry violates the FK (PRAGMA foreign_keys is on
    // in better-sqlite3 only when enabled, so instead inject a bad column to force
    // a SQL error on insert).
    const broken: BackupDocument = JSON.parse(JSON.stringify(good));
    (broken.tables.moods as Record<string, unknown>[]).push({ no_such_column: 1 });

    await expect(importAllTables(a.db, broken)).rejects.toThrow();
    // The DELETE-then-INSERT ran inside a transaction that rolled back → original
    // rows are still present and unchanged.
    expect(dumpAll(a.sqlite)).toEqual(before);

    a.sqlite.close();
  });
});
