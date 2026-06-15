import { open } from '@op-engineering/op-sqlite';
import { drizzle, type OPSQLiteDatabase } from 'drizzle-orm/op-sqlite';

import { applySchema } from './init';
import { getOrCreateDbKey } from './keystore';
import * as schema from './schema';

export type Database = OPSQLiteDatabase<typeof schema>;

let _db: Database | null = null;

/// Opens the on-device database, encrypted at rest with SQLCipher (op-sqlite is
/// built with SQLCipher; the `encryptionKey` enables it). The key lives in OS
/// secure storage. Device-only — tests use better-sqlite3 against the same
/// schema. UNVERIFIED on a real device until the iOS/Android toolchain is set up.
export async function openDatabase(): Promise<Database> {
  if (_db) return _db;
  const key = await getOrCreateDbKey();
  const op = open({ name: 'health_routine.db', encryptionKey: key });
  await applySchema((statement) => op.execute(statement));
  _db = drizzle(op, { schema });
  return _db;
}
