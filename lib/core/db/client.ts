import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { applySchema } from './init';
import { getOrCreateDbKey } from './keystore';
import * as schema from './schema';

/// A drizzle SQLite handle over our schema. Concretely it's either op-sqlite
/// (encrypted, on a native build) or expo-sqlite (the Expo Go / no-native-build
/// fallback). Callers only touch the shared drizzle query API, so the driver is
/// abstracted away here — this is the same broad shape the db helpers accept.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = BaseSQLiteDatabase<any, any, typeof schema>;

let _db: Database | null = null;

/// Opens the on-device database and applies the schema.
///
/// Prefers **op-sqlite**, which is compiled with SQLCipher (`package.json` →
/// `op-sqlite.sqlcipher`) so the file is encrypted at rest with the key from OS
/// secure storage. When that native module isn't present — Expo Go, or web — it
/// falls back to **expo-sqlite** (bundled in Expo Go), so the app is fully usable
/// without a custom native build.
///
/// ⚠️ The expo-sqlite fallback is NOT encrypted — real at-rest encryption only
/// happens on a native build with op-sqlite. Both drivers are imported lazily so
/// neither is evaluated where it's missing; if both fail the error propagates and
/// `DatabaseProvider` leaves `db` null (screens show placeholders). Tests bypass
/// this and run better-sqlite3 against the same schema.
export async function openDatabase(): Promise<Database> {
  if (_db) return _db;
  const key = await getOrCreateDbKey();
  try {
    const { open } = await import('@op-engineering/op-sqlite');
    const { drizzle } = await import('drizzle-orm/op-sqlite');
    const op = open({ name: 'health_routine.db', encryptionKey: key });
    await applySchema((statement) => op.execute(statement));
    _db = drizzle(op, { schema });
  } catch (nativeError) {
    const { openDatabaseSync } = await import('expo-sqlite');
    const { drizzle } = await import('drizzle-orm/expo-sqlite');
    const db = openDatabaseSync('health_routine.db');
    await applySchema((statement) => db.execSync(statement));
    _db = drizzle(db, { schema });
    console.warn(
      'op-sqlite unavailable — using the unencrypted expo-sqlite fallback ' +
        '(Expo Go / no native build).',
      nativeError,
    );
  }
  return _db;
}
