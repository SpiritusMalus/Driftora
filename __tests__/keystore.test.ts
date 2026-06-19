import { beforeEach, describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as SecureStore from 'expo-secure-store';

import { encryptBlob } from '@/lib/core/crypto/e2ee';
import { exportAllTables } from '@/lib/core/db/backup';
import { applySchema } from '@/lib/core/db/init';
import {
  getMasterPublicKey,
  getOrCreateDbKey,
  getOrCreateMasterKeyPair,
} from '@/lib/core/db/keystore';
import { keyPairMatches } from '@/lib/core/crypto/e2ee';
import * as schema from '@/lib/core/db/schema';
import { addWin, updateSettings } from '@/lib/core/db/settings';

// The mock (mapped via moduleNameMapper) exposes __reset / __dump for assertions.
const SecureStoreMock = SecureStore as unknown as {
  __reset(): void;
  __dump(): Record<string, string>;
};

const DB_KEY_ITEM = 'db_encryption_key_v1';
const MASTER_KEY_ITEM = 'e2ee_master_key_v1';

beforeEach(() => {
  SecureStoreMock.__reset();
});

describe('master keypair in secure store', () => {
  it('generates a valid keypair and persists it under its own item (separate from the DB key)', async () => {
    await getOrCreateDbKey();
    const pair = await getOrCreateMasterKeyPair();

    expect(keyPairMatches(pair.privateKey, pair.publicKey)).toBe(true);

    const dump = SecureStoreMock.__dump();
    // Two distinct items — the device-local SQLCipher key and the portable master key.
    expect(Object.keys(dump).sort()).toEqual([DB_KEY_ITEM, MASTER_KEY_ITEM].sort());
    expect(dump[DB_KEY_ITEM]).not.toEqual(dump[MASTER_KEY_ITEM]);
  });

  it('is idempotent — a second call returns the same keypair', async () => {
    const first = await getOrCreateMasterKeyPair();
    const second = await getOrCreateMasterKeyPair();
    expect(second).toEqual(first);
    expect(await getMasterPublicKey()).toBe(first.publicKey);
  });

  it('does NOT reuse the SQLCipher device key as the master key', async () => {
    const dbKey = await getOrCreateDbKey();
    const pair = await getOrCreateMasterKeyPair();
    expect(pair.privateKey).not.toEqual(dbKey);
    expect(pair.publicKey).not.toEqual(dbKey);
  });

  it('the master private key lives ONLY in secure store — and only under the master item', async () => {
    const pair = await getOrCreateMasterKeyPair();
    const dump = SecureStoreMock.__dump();

    // The private key must appear in exactly one place: the master item's JSON.
    const occurrences = Object.entries(dump).filter(([, v]) => v.includes(pair.privateKey));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0][0]).toBe(MASTER_KEY_ITEM);

    // The DB-key item must never contain the master private key.
    expect(dump[DB_KEY_ITEM]?.includes(pair.privateKey) ?? false).toBe(false);
  });

  it('the master private key is never included in a backup blob', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    await applySchema((stmt) => sqlite.exec(stmt));
    await updateSettings(db, { targetKcal: 2000 });
    await addWin(db, 'manual', 'first win');

    const pair = await getOrCreateMasterKeyPair();
    const doc = await exportAllTables(db);
    const json = JSON.stringify(doc);

    // The plaintext export must not contain the private key...
    expect(json.includes(pair.privateKey)).toBe(false);

    // ...and neither must the encrypted blob the app actually writes out.
    const blob = encryptBlob(new TextEncoder().encode(json), pair.publicKey);
    const blobLatin1 = Array.from(blob)
      .map((b) => String.fromCharCode(b))
      .join('');
    expect(blobLatin1.includes(pair.privateKey)).toBe(false);

    sqlite.close();
  });
});
