import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Bump when the on-disk JSON shape changes in a non-additive way. `importAllTables`
/// rejects a document whose major version it doesn't understand.
export const BACKUP_FORMAT_VERSION = 1;
const APP_ID = 'driftora';

/// Every app table that holds user data, in FK-safe insert order (parents before
/// children: `food_items.entry_id` references `food_entries.id`). Logical export
/// over the raw SQLCipher file — portable across devices and driver versions, and
/// independent of the device-bound encryption key. Kept in sync with `schema.ts`
/// / `init.ts`; `__tests__/backup.test.ts` asserts coverage against the live DDL.
const EXPORT_TABLES = [
  'food_entries',
  'food_items',
  'steps_days',
  'weights',
  'moods',
  'diary_entries',
  'wins',
  'app_settings',
] as const;

type TableName = (typeof EXPORT_TABLES)[number];

/// A single table's rows as raw SQLite primitives (number | string | null —
/// SQLite has no native bool/date, so timestamps are epoch-ms integers and
/// booleans are 0/1, exactly as stored). Portable JSON with no driver coupling.
export type TableRows = Record<string, number | string | null>[];

/// The versioned backup document. `tables` maps each table name to its rows.
export interface BackupDocument {
  app: typeof APP_ID;
  formatVersion: number;
  exportedAt: string; // ISO-8601, informational only
  tables: Record<TableName, TableRows>;
}

/// Reads every app table via `SELECT *` and serializes it to a versioned,
/// device-independent document. Uses raw SQL (not the typed query builder) so the
/// values stay as stored SQLite primitives — round-tripping is then lossless and
/// schema-shape-agnostic (new columns are picked up automatically).
///
/// NOTE: this deliberately does NOT include any key material. The master private
/// key lives only in expo-secure-store and is never read here; a backup is
/// encrypted TO the master public key by the caller (see `app/settings/backup.tsx`),
/// it never CONTAINS the key.
export async function exportAllTables(db: AnyDb): Promise<BackupDocument> {
  const tables = {} as Record<TableName, TableRows>;
  for (const table of EXPORT_TABLES) {
    tables[table] = await selectAll(db, table);
  }
  return {
    app: APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

/// Restores a backup document into the database, replacing all existing rows
/// (v1 policy: replace-all, not merge — the simplest model with no ambiguity).
/// Runs inside a single transaction: every app table is cleared and repopulated,
/// or nothing changes if any statement fails. Idempotent — importing the same
/// document twice yields the same DB state.
///
/// Assumes the schema/tables already exist (the app applies the DDL on open; in
/// tests call `applySchema` first). Rejects a document from a different app or an
/// unknown format version.
export async function importAllTables(db: AnyDb, doc: BackupDocument): Promise<void> {
  validateDocument(doc);

  await db.run(sql`BEGIN`);
  try {
    // Delete children before parents to respect the FK (reverse insert order),
    // then insert parents before children.
    for (let i = EXPORT_TABLES.length - 1; i >= 0; i--) {
      const table = EXPORT_TABLES[i];
      await db.run(sql`DELETE FROM ${sql.identifier(table)}`);
    }
    for (const table of EXPORT_TABLES) {
      const rows = doc.tables[table] ?? [];
      for (const row of rows) {
        await insertRow(db, table, row);
      }
    }
    await db.run(sql`COMMIT`);
  } catch (e) {
    try {
      await db.run(sql`ROLLBACK`);
    } catch {
      // If ROLLBACK itself fails there's nothing more we can do; surface the
      // original error below.
    }
    throw e;
  }
}

/// The list of tables this version exports — exposed so the drift test can assert
/// it covers exactly the app's data tables.
export function backupTableNames(): readonly string[] {
  return EXPORT_TABLES;
}

async function selectAll(db: AnyDb, table: TableName): Promise<TableRows> {
  const rows = (await db.all(sql`SELECT * FROM ${sql.identifier(table)}`)) as Record<
    string,
    number | string | null
  >[];
  // Normalize undefined → null so the JSON is stable across drivers.
  return rows.map((r) => {
    const out: Record<string, number | string | null> = {};
    for (const k of Object.keys(r)) {
      const v = r[k];
      out[k] = v === undefined ? null : (v as number | string | null);
    }
    return out;
  });
}

async function insertRow(
  db: AnyDb,
  table: TableName,
  row: Record<string, number | string | null>,
): Promise<void> {
  const columns = Object.keys(row);
  if (columns.length === 0) return;

  const colSql = columns.map((c) => sql.identifier(c));
  const valSql = columns.map((c) => sql`${row[c]}`);

  await db.run(
    sql`INSERT INTO ${sql.identifier(table)} (${sql.join(colSql, sql`, `)}) VALUES (${sql.join(
      valSql,
      sql`, `,
    )})`,
  );
}

function validateDocument(doc: BackupDocument): void {
  if (!doc || typeof doc !== 'object') {
    throw new Error('backup: not a valid document');
  }
  if (doc.app !== APP_ID) {
    throw new Error(`backup: wrong app (expected ${APP_ID}, got ${String(doc.app)})`);
  }
  if (doc.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `backup: unsupported format version ${String(doc.formatVersion)} (this build reads ${BACKUP_FORMAT_VERSION})`,
    );
  }
  if (!doc.tables || typeof doc.tables !== 'object') {
    throw new Error('backup: missing tables');
  }
}
