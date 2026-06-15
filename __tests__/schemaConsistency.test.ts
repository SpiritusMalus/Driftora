import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { Table } from 'drizzle-orm';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';

/// Tripwire for the one piece of schema tech debt: `INIT_SQL` (lib/core/db/init.ts)
/// is hand-synced with the Drizzle schema (lib/core/db/schema.ts). They are two
/// sources of truth — the Drizzle defs drive types + the query builder, the DDL
/// actually creates the tables (on-device via op-sqlite AND here via
/// better-sqlite3). If they drift, `tsc` stays green (Drizzle trusts the schema)
/// and the app crashes at runtime with "no such column" on a device we can't
/// test on. This test runs the real DDL, introspects the resulting tables with
/// PRAGMA, and asserts they match what Drizzle declares — so any drift fails in
/// jest instead. Replace with drizzle-kit migrations once the schema first
/// evolves on shipped devices (CREATE TABLE IF NOT EXISTS can't ALTER existing
/// tables — that is the real trigger to switch).

/// Every table object exported from schema.ts (runtime values only — the
/// `export type` aliases are erased and never reach here).
const drizzleTables = (Object.values(schema) as unknown[]).filter(
  (v): v is Table => is(v, Table),
);

/// What Drizzle says a column should be. PK columns are special-cased: SQLite
/// reports a rowid-alias PK as notnull=0 / no default regardless of how it was
/// declared, while Drizzle reports notNull=true / hasDefault=true. Comparing
/// those would be a guaranteed false mismatch, so for PK columns we assert only
/// name + type + pk.
function drizzleShape(col: ReturnType<typeof getTableColumns>[string]) {
  const base = {
    name: col.name,
    type: col.getSQLType().toLowerCase(),
    pk: col.primary,
  };
  if (col.primary) return base;
  return { ...base, notNull: col.notNull, hasDefault: col.hasDefault };
}

interface PragmaColumn {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

/// The same shape, read back from the table the DDL actually built.
function pragmaShape(row: PragmaColumn) {
  const isPk = row.pk > 0;
  const base = { name: row.name, type: row.type.toLowerCase(), pk: isPk };
  if (isPk) return base;
  return {
    ...base,
    notNull: row.notnull === 1,
    hasDefault: row.dflt_value !== null,
  };
}

function byName<T extends { name: string }>(a: T, b: T) {
  return a.name.localeCompare(b.name);
}

describe('schema consistency (INIT_SQL DDL vs Drizzle schema)', () => {
  const sqlite = new BetterSqlite3(':memory:');
  // Build the tables from the real DDL exactly as the app and the other tests do.
  applySchema((stmt) => sqlite.exec(stmt));

  it('creates exactly the tables the Drizzle schema declares (no extras, none missing)', () => {
    const declared = drizzleTables.map(getTableName).sort();
    const created = (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort();

    expect(created).toEqual(declared);
  });

  // One assertion per table so a drift points straight at the offending table.
  for (const table of drizzleTables) {
    const tableName = getTableName(table);

    it(`${tableName}: columns, types, PK, NOT NULL and defaults match the DDL`, () => {
      const expected = Object.values(getTableColumns(table))
        .map(drizzleShape)
        .sort(byName);

      const actual = (
        sqlite.pragma(`table_info(${tableName})`) as PragmaColumn[]
      )
        .map(pragmaShape)
        .sort(byName);

      expect(actual).toEqual(expected);
    });
  }
});
