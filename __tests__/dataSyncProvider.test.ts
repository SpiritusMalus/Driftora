import { beforeEach, describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as SecureStore from 'expo-secure-store';
import { decodeBase64 } from 'tweetnacl-util';

import { grantSyncConsent } from '@/lib/core/consent/consent';
import { backupTableNames } from '@/lib/core/db/backup';
import { saveDiaryEntry } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import { getOrCreateMasterKeyPair } from '@/lib/core/db/keystore';
import { logMood } from '@/lib/core/db/mood';
import * as schema from '@/lib/core/db/schema';
import { addWin, updateSettings } from '@/lib/core/db/settings';
import { upsertSteps } from '@/lib/core/db/steps';
import {
  DataSyncUnavailableError,
  unavailableDataSyncProvider,
  type DataSyncKind,
  type DataSyncProvider,
  type SnapshotMeta,
  type SnapshotPayload,
} from '@/lib/core/sync/dataSyncProvider';
import { pullVia, pushVia, SyncDisabledError } from '@/lib/core/sync/syncClient';

const SecureStoreMock = SecureStore as unknown as { __reset(): void };

beforeEach(() => {
  SecureStoreMock.__reset();
});

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/// Seed a few tables incl. ASCII + Cyrillic markers we can later prove never
/// crossed the provider boundary in plaintext.
async function seed(db: ReturnType<typeof makeDb>['db']) {
  await db.insert(schema.foodEntries).values({
    ts: new Date(2026, 5, 18, 9),
    rawText: 'омлет из трёх яиц',
    source: 'text',
    kcal: 220,
    proteinG: 19,
    fatG: 15,
    carbG: 2,
    confirmed: true,
  });
  await upsertSteps(db, '2026-06-18', 8123);
  await logMood(db, 7);
  await saveDiaryEntry(db, {
    situation: 'TOPSECRET-SITUATION-MARKER',
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
  await addWin(db, 'manual', 'TOPSECRET-WIN-MARKER walked 8000 steps');
}

function dumpAll(sqlite: BetterSqlite3.Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of backupTableNames()) {
    out[t] = sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  return out;
}

/**
 * An in-memory fake transport. Stores ONE sealed payload (last-writer-wins by
 * `updatedAt`) and records every payload that crossed the boundary, so a test can
 * assert exactly what left the device.
 */
function makeFakeProvider(kind: DataSyncKind = 'icloud') {
  const pushed: SnapshotPayload[] = [];
  let stored: SnapshotPayload | null = null;
  const provider: DataSyncProvider = {
    kind,
    async isAvailableAsync() {
      return true;
    },
    async pushSnapshot(blobB64: string, meta: SnapshotMeta): Promise<SnapshotMeta> {
      const incoming: SnapshotPayload = {
        blobB64,
        meta: { ...meta, deviceId: meta.deviceId || 'fake-device' },
      };
      pushed.push(incoming);
      // Last-writer-wins: a strictly older snapshot never overwrites a newer one.
      if (!stored || incoming.meta.updatedAt >= stored.meta.updatedAt) {
        stored = incoming;
      }
      return stored.meta;
    },
    async pullSnapshot(): Promise<SnapshotPayload | null> {
      return stored;
    },
  };
  return {
    provider,
    pushed,
    get stored() {
      return stored;
    },
  };
}

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

describe('data-sync provider seam (platform-native-sync item 1)', () => {
  it('refuses to push or pull while sync is OFF — the provider is never touched', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const master = await getOrCreateMasterKeyPair();
    const fake = makeFakeProvider();

    // Default settings → syncEnabled is false.
    await expect(pushVia(a.db, master, fake.provider)).rejects.toBeInstanceOf(SyncDisabledError);
    await expect(pullVia(a.db, master, fake.provider)).rejects.toBeInstanceOf(SyncDisabledError);
    expect(fake.pushed.length).toBe(0);
    expect(fake.stored).toBeNull();

    a.sqlite.close();
  });

  it('round-trips the full DB through a fake provider (push on A → pull on B, same key)', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    await updateSettings(a.db, { targetKcal: 2100, stepsGoal: 6500, hideCalories: true });
    const master = await getOrCreateMasterKeyPair();
    const before = dumpAll(a.sqlite);

    const fake = makeFakeProvider();
    const meta = await pushVia(a.db, master, fake.provider);
    expect(meta.size).toBeGreaterThan(0);
    expect(meta.updatedAt).not.toBe('');

    // Device B: same master key, empty DB, pull.
    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    await grantSyncConsent(b.db);
    const pulled = await pullVia(b.db, master, fake.provider);
    expect(pulled.kind).toBe('imported');

    const after = dumpAll(b.sqlite);
    for (const t of backupTableNames()) {
      if (t === 'app_settings') continue; // B writes its own consent row
      expect(after[t]).toEqual(before[t]);
    }
    const winRow = b.sqlite.prepare('SELECT message FROM wins').get() as { message: string };
    expect(winRow.message).toContain('walked 8000 steps');

    a.sqlite.close();
    b.sqlite.close();
  });

  it('only ciphertext + non-secret metadata cross the boundary — never the private key or plaintext', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();
    const fake = makeFakeProvider();

    await pushVia(a.db, master, fake.provider);
    expect(fake.pushed.length).toBe(1);
    const crossed = fake.pushed[0];

    // The metadata carries EXACTLY the three non-secret fields.
    expect(Object.keys(crossed.meta).sort()).toEqual(['deviceId', 'size', 'updatedAt']);

    // Everything that crossed, serialized — no private key, no plaintext markers.
    const crossedText = JSON.stringify(crossed);
    expect(crossedText.includes(master.privateKey)).toBe(false);
    expect(crossedText.includes('TOPSECRET-WIN-MARKER')).toBe(false);
    expect(crossedText.includes('TOPSECRET-SITUATION-MARKER')).toBe(false);
    expect(crossedText.includes('омлет из трёх яиц')).toBe(false);

    // And the raw private-key bytes are not embedded in the (base64) blob itself.
    const blobBytes = decodeBase64(crossed.blobB64);
    const keyBytes = decodeBase64(master.privateKey);
    expect(containsSubsequence(blobBytes, keyBytes)).toBe(false);

    a.sqlite.close();
  });

  it('is last-writer-wins by updatedAt (a stale push never overwrites a newer snapshot)', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();
    const fake = makeFakeProvider();

    // Push directly through the provider with controlled timestamps.
    await fake.provider.pushSnapshot('older==', { updatedAt: '2026-06-01T00:00:00Z', size: 7, deviceId: 'a' });
    await fake.provider.pushSnapshot('newer==', { updatedAt: '2026-06-20T00:00:00Z', size: 7, deviceId: 'b' });
    expect(fake.stored?.blobB64).toBe('newer==');

    // A late-arriving STALE push must not clobber the newer stored snapshot.
    await fake.provider.pushSnapshot('stale==', { updatedAt: '2026-06-10T00:00:00Z', size: 7, deviceId: 'c' });
    expect(fake.stored?.blobB64).toBe('newer==');
    expect(fake.stored?.meta.deviceId).toBe('b');

    a.sqlite.close();
  });

  it('the unavailable provider degrades cleanly: push throws DataSyncUnavailableError, pull is empty', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();

    expect(await unavailableDataSyncProvider.isAvailableAsync()).toBe(false);
    await expect(pushVia(a.db, master, unavailableDataSyncProvider)).rejects.toBeInstanceOf(
      DataSyncUnavailableError,
    );
    const pulled = await pullVia(a.db, master, unavailableDataSyncProvider);
    expect(pulled.kind).toBe('empty');

    a.sqlite.close();
  });
});
