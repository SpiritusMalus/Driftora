import { beforeEach, describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as SecureStore from 'expo-secure-store';
import { decodeBase64, decodeUTF8, encodeBase64 } from 'tweetnacl-util';

import { encryptBlob } from '@/lib/core/crypto/e2ee';
import { generateRecoveryPhrase } from '@/lib/core/crypto/recovery';
import { backupTableNames, exportAllTables, importAllTables } from '@/lib/core/db/backup';
import {
  buildBackupFile,
  decryptBackupBody,
  parseBackupFile,
  recoverMasterKeyFromFile,
} from '@/lib/core/db/backupFile';
import { saveDiaryEntry } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import {
  getOrCreateMasterKeyPair,
  hasMasterKey,
  installMasterKeyPair,
} from '@/lib/core/db/keystore';
import { logMood } from '@/lib/core/db/mood';
import * as schema from '@/lib/core/db/schema';
import { addWin, updateSettings } from '@/lib/core/db/settings';
import { upsertSteps } from '@/lib/core/db/steps';
import { upsertWeight } from '@/lib/core/db/weight';

const SecureStoreMock = SecureStore as unknown as { __reset(): void };

beforeEach(() => {
  SecureStoreMock.__reset();
});

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/// Seed one row into every app table (mirrors backup.test.ts) so a round-trip
/// exercises them all.
async function seed(db: ReturnType<typeof makeDb>['db']) {
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
  await upsertSteps(db, '2026-06-18', 8123);
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

function dumpAll(sqlite: BetterSqlite3.Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of backupTableNames()) {
    out[t] = sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  return out;
}

describe('backup file envelope (Phase 2 recovery header)', () => {
  it('end-to-end: backup-with-recovery on device A restores on a FRESH device B via phrase', async () => {
    // ── Device A: seed, generate master key, build a recovery-enabled backup. ──
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const before = dumpAll(a.sqlite);
    for (const t of backupTableNames()) {
      expect((before[t] as unknown[]).length).toBeGreaterThan(0);
    }

    const doc = await exportAllTables(a.db);
    const masterA = await getOrCreateMasterKeyPair();
    const phrase = generateRecoveryPhrase();
    const fileBytes = await buildBackupFile(doc, masterA, phrase);

    // ── Simulate moving to a fresh device: wipe secure-store (no master key). ──
    SecureStoreMock.__reset();
    expect(await hasMasterKey()).toBe(false);

    // ── Device B: parse the file, recover the key from the phrase, import. ──
    const parsed = parseBackupFile(fileBytes);
    expect(parsed.legacy).toBe(false);
    expect(parsed.recovery).not.toBeNull();

    const recoveredPriv = await recoverMasterKeyFromFile(parsed, phrase);
    expect(recoveredPriv).toBe(masterA.privateKey);
    await installMasterKeyPair(recoveredPriv);
    expect(await hasMasterKey()).toBe(true);

    const restoredDoc = decryptBackupBody(parsed, recoveredPriv);

    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    await updateSettings(b.db, {}); // default settings row to be replaced
    await importAllTables(b.db, restoredDoc);

    // Every table round-trips byte-for-byte.
    expect(dumpAll(b.sqlite)).toEqual(before);

    a.sqlite.close();
    b.sqlite.close();
  });

  it('a WRONG phrase fails to recover the key on the fresh device', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const doc = await exportAllTables(a.db);
    const master = await getOrCreateMasterKeyPair();
    const fileBytes = await buildBackupFile(doc, master, generateRecoveryPhrase());

    SecureStoreMock.__reset();
    const parsed = parseBackupFile(fileBytes);
    await expect(recoverMasterKeyFromFile(parsed, generateRecoveryPhrase())).rejects.toThrow();

    a.sqlite.close();
  });

  it('same-device restore: decrypt the body directly with the on-device key', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const doc = await exportAllTables(a.db);
    const master = await getOrCreateMasterKeyPair();
    const fileBytes = await buildBackupFile(doc, master, generateRecoveryPhrase());

    // Key is still present → no phrase needed.
    expect(await hasMasterKey()).toBe(true);
    const parsed = parseBackupFile(fileBytes);
    const restored = decryptBackupBody(parsed, master.privateKey);
    expect(restored.tables).toEqual(doc.tables);

    a.sqlite.close();
  });

  it('back-compat: a legacy Phase-1 raw encryptBlob still parses + decrypts (no recovery header)', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const doc = await exportAllTables(a.db);
    const master = await getOrCreateMasterKeyPair();

    // Exactly what Phase 1 wrote: a raw encryptBlob of the JSON, no envelope.
    const legacyBytes = encryptBlob(decodeUTF8(JSON.stringify(doc)), master.publicKey);

    const parsed = parseBackupFile(legacyBytes);
    expect(parsed.legacy).toBe(true);
    expect(parsed.recovery).toBeNull();
    const restored = decryptBackupBody(parsed, master.privateKey);
    expect(restored.tables).toEqual(doc.tables);

    a.sqlite.close();
  });

  it('a body-only backup (no phrase) parses with a null recovery header', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const doc = await exportAllTables(a.db);
    const master = await getOrCreateMasterKeyPair();

    const fileBytes = await buildBackupFile(doc, master); // no phrase
    const parsed = parseBackupFile(fileBytes);
    expect(parsed.legacy).toBe(false);
    expect(parsed.recovery).toBeNull();
    expect(decryptBackupBody(parsed, master.privateKey).tables).toEqual(doc.tables);

    a.sqlite.close();
  });

  it('the backup file contains NO plaintext health data and NO plaintext master key', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    // A distinctive marker we can search for in the file bytes.
    await addWin(a.db, 'manual', 'TOPSECRET-WIN-MARKER-7e1');
    const doc = await exportAllTables(a.db);
    const master = await getOrCreateMasterKeyPair();
    const phrase = generateRecoveryPhrase();
    const fileBytes = await buildBackupFile(doc, master, phrase);

    const asText = new TextDecoder().decode(fileBytes);
    // The diary/win plaintext must not be in the file.
    expect(asText.includes('TOPSECRET-WIN-MARKER-7e1')).toBe(false);
    expect(asText.includes('walked 8000 steps')).toBe(false);
    // The master private key (base64) must not be in the file...
    expect(asText.includes(master.privateKey)).toBe(false);
    // ...nor its raw bytes anywhere in the decoded body/recovery sections.
    const parsed = parseBackupFile(fileBytes);
    const keyBytes = decodeBase64(master.privateKey);
    expect(containsSubsequence(parsed.bodyCiphertext, keyBytes)).toBe(false);
    expect(parsed.recovery).not.toBeNull();
    expect(containsSubsequence(decodeBase64(parsed.recovery as string), keyBytes)).toBe(false);

    a.sqlite.close();
  });

  it('rejects a Phase-2 envelope with an unknown format version', () => {
    const fakeEnvelope = {
      magic: 'hr-backup',
      formatVersion: 999,
      body: encodeBase64(new Uint8Array([1, 2, 3])),
      createdAt: '',
    };
    const bytes = decodeUTF8(JSON.stringify(fakeEnvelope));
    expect(() => parseBackupFile(bytes)).toThrow();
  });
});

function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
