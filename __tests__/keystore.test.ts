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
  hasMasterKey,
  installMasterKeyPair,
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

describe('recovery: installing a master key on a fresh device', () => {
  it('hasMasterKey reflects whether a key is present', async () => {
    expect(await hasMasterKey()).toBe(false);
    await getOrCreateMasterKeyPair();
    expect(await hasMasterKey()).toBe(true);
  });

  it('installMasterKeyPair persists a recovered key and getOrCreateMasterKeyPair returns it', async () => {
    // A key produced elsewhere (e.g. unwrapped from a backup recovery header).
    const external = await getOrCreateMasterKeyPair();
    SecureStoreMock.__reset();
    expect(await hasMasterKey()).toBe(false);

    const installed = await installMasterKeyPair(external.privateKey);
    expect(installed.privateKey).toBe(external.privateKey);
    expect(installed.publicKey).toBe(external.publicKey);

    // The next read returns the installed pair (idempotent, no regeneration).
    const reread = await getOrCreateMasterKeyPair();
    expect(reread).toEqual(external);
    expect(await getMasterPublicKey()).toBe(external.publicKey);
  });

  it('installMasterKeyPair heals/derives the public key from the private key', async () => {
    const pair = await getOrCreateMasterKeyPair();
    SecureStoreMock.__reset();
    const installed = await installMasterKeyPair(pair.privateKey);
    expect(keyPairMatches(installed.privateKey, installed.publicKey)).toBe(true);
    expect(installed.publicKey).toBe(pair.publicKey);
  });

  it('the installed private key lives ONLY under the master item in secure store', async () => {
    const pair = await getOrCreateMasterKeyPair();
    SecureStoreMock.__reset();
    await installMasterKeyPair(pair.privateKey);
    const dump = SecureStoreMock.__dump();
    const occurrences = Object.entries(dump).filter(([, v]) => v.includes(pair.privateKey));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0][0]).toBe(MASTER_KEY_ITEM);
  });
});
