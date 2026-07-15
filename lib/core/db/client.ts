import Constants, { ExecutionEnvironment } from 'expo-constants';
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

/// Which SQLite driver actually backs the open database. `op-sqlite` means the
/// file is encrypted at rest (SQLCipher); `expo-sqlite` is the unencrypted Expo
/// Go / web fallback. Exposed so the UI can tell the user whether their data is
/// truly encrypted on this build (a silent fallback otherwise looks identical).
export type DbDriver = 'op-sqlite' | 'expo-sqlite';

let _db: Database | null = null;
let _driver: DbDriver | null = null;

/// The driver backing the open database, or null before `openDatabase` resolves.
export function getDbDriver(): DbDriver | null {
  return _driver;
}

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
///
/// In **Expo Go** the op-sqlite native module is absent and its very import throws
/// ("Base module not found"), which surfaces as a red error even when caught — so
/// we skip the op-sqlite path entirely there (detected via `executionEnvironment`)
/// and go straight to expo-sqlite. op-sqlite is still preferred on any native build.
export async function openDatabase(): Promise<Database> {
  if (_db) return _db;
  const key = await getOrCreateDbKey();
  const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

  if (!isExpoGo) {
    // Load the native module FIRST, separately from opening the DB. A failure to
    // import means op-sqlite isn't linked (legitimate → fall through to the
    // unencrypted expo-sqlite path). But if the module IS present and the
    // ENCRYPTED open/schema then fails, we must NOT silently create an
    // unencrypted expo-sqlite `driftora.db` — that would persist all health data
    // in plaintext with only a console warning. In that case we fail closed:
    // rethrow so `DatabaseProvider` leaves `db` null (screens show placeholders)
    // rather than downgrade at-rest encryption behind the user's back.
    let opModule: typeof import('@op-engineering/op-sqlite') | null = null;
    let drizzleOp: typeof import('drizzle-orm/op-sqlite') | null = null;
    try {
      opModule = await import('@op-engineering/op-sqlite');
      drizzleOp = await import('drizzle-orm/op-sqlite');
    } catch (moduleAbsent) {
      console.warn('op-sqlite module not present — falling back to expo-sqlite.', moduleAbsent);
      opModule = null;
    }

    if (opModule && drizzleOp) {
      try {
        const op = opModule.open({ name: 'driftora.db', encryptionKey: key });
        await applySchema((statement) => op.execute(statement));
        _db = drizzleOp.drizzle(op, { schema });
        _driver = 'op-sqlite';
        return _db;
      } catch (openError) {
        console.error(
          'op-sqlite is present but the encrypted open failed — refusing to fall back to unencrypted storage.',
          openError,
        );
        throw openError;
      }
    }
  }

  const { openDatabaseSync } = await import('expo-sqlite');
  const { drizzle } = await import('drizzle-orm/expo-sqlite');
  const db = openDatabaseSync('driftora.db');
  await applySchema((statement) => db.execSync(statement));
  _db = drizzle(db, { schema });
  _driver = 'expo-sqlite';
  if (isExpoGo) {
    console.warn('Expo Go — using the unencrypted expo-sqlite fallback (no native build).');
  }
  return _db;
}
