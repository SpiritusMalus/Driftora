import { beforeEach, describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import nacl from 'tweetnacl';
import * as SecureStore from 'expo-secure-store';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

import { grantSyncConsent } from '@/lib/core/consent/consent';
import { backupTableNames, exportAllTables } from '@/lib/core/db/backup';
import { saveDiaryEntry } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import { getOrCreateMasterKeyPair } from '@/lib/core/db/keystore';
import { logMood } from '@/lib/core/db/mood';
import * as schema from '@/lib/core/db/schema';
import { addWin, updateSettings } from '@/lib/core/db/settings';
import { upsertSleep } from '@/lib/core/db/sleep';
import { upsertSteps } from '@/lib/core/db/steps';
import { upsertWeight } from '@/lib/core/db/weight';
import {
  pullSnapshot,
  pushSnapshot,
  SyncDisabledError,
  type FetchLike,
  type SyncConfig,
} from '@/lib/core/sync/syncClient';

const SecureStoreMock = SecureStore as unknown as { __reset(): void };

beforeEach(() => {
  SecureStoreMock.__reset();
});

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/// Seed one row into every app table so a round-trip exercises them all.
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
  await db.insert(schema.foodChoices).values({
    key: 'RU::творог',
    name: 'Творог 5%',
    per100: JSON.stringify({ source: 'fatsecret', kcal: 121, prot: 17, fat: 5, carb: 3, minerals: {} }),
    ts: new Date(2026, 5, 18, 9),
  });
  await upsertSteps(db, '2026-06-18', 8123);
  await upsertSleep(db, '2026-06-18', 450);
  await upsertWeight(db, '2026-06-18', 71.4);
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
  await updateSettings(db, { targetKcal: 2100, stepsGoal: 6500, hideCalories: true });
}

function dumpAll(sqlite: BetterSqlite3.Database): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of backupTableNames()) {
    out[t] = sqlite.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
  }
  return out;
}

/// A captured HTTP request, so tests can assert exactly what left the device.
interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * An in-memory fake of the sync server, implemented with the SAME TweetNaCl
 * operations the real `sync-server/` uses, so the challenge-solve and the
 * snapshot round-trip are REAL crypto end-to-end (no stubbing of the security-
 * critical paths). Captures every request for shape assertions.
 */
function makeFakeServer() {
  const requests: CapturedRequest[] = [];
  // account public_key → stored snapshot (raw ciphertext bytes + metadata)
  const accounts = new Set<string>();
  const snapshots = new Map<
    string,
    { blob: Uint8Array; updated_at: string; size: number; device_id: string }
  >();
  // challenge_id → { pub, nonce }
  const challenges = new Map<string, { pub: string; nonce: Uint8Array }>();
  // token → account public_key
  const sessions = new Map<string, string>();
  let counter = 0;

  function json(status: number, obj: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => obj,
      text: async () => JSON.stringify(obj),
    };
  }

  /// Encrypt a nonce TO a public key (anonymous box) — the server's challenge.
  function encryptForPublicKey(plaintext: Uint8Array, pubB64: string): string {
    const recipientPub = decodeBase64(pubB64);
    const boxNonce = nacl.randomBytes(nacl.box.nonceLength);
    const eph = nacl.box.keyPair();
    const wrapped = nacl.box(plaintext, boxNonce, recipientPub, eph.secretKey);
    const blob = new Uint8Array(boxNonce.length + eph.publicKey.length + wrapped.length);
    blob.set(boxNonce, 0);
    blob.set(eph.publicKey, boxNonce.length);
    blob.set(wrapped, boxNonce.length + eph.publicKey.length);
    return encodeBase64(blob);
  }

  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    requests.push({ url, method, headers: init?.headers ?? {}, body: init?.body });
    const u = new URL(url, 'http://sync.test');
    const path = u.pathname;

    // Register account.
    if (path === '/v1/account' && method === 'POST') {
      const b = JSON.parse(init?.body ?? '{}') as { public_key?: string };
      if (!b.public_key) return json(400, { detail: 'no key' });
      accounts.add(b.public_key);
      return json(200, { account_id: 'acct-' + b.public_key.slice(0, 6), public_key: b.public_key });
    }

    // Issue challenge (encrypt a random nonce to the public key).
    if (path === '/v1/auth/challenge' && method === 'GET') {
      const pub = u.searchParams.get('public_key');
      if (!pub) return json(400, { detail: 'no key' });
      const nonce = nacl.randomBytes(32);
      const id = 'ch-' + ++counter;
      challenges.set(id, { pub, nonce });
      return json(200, { challenge_id: id, encrypted_challenge: encryptForPublicKey(nonce, pub) });
    }

    // Verify the solved nonce → session token.
    if (path === '/v1/auth/login' && method === 'POST') {
      const b = JSON.parse(init?.body ?? '{}') as { challenge_id?: string; nonce?: string };
      const ch = b.challenge_id ? challenges.get(b.challenge_id) : undefined;
      if (!ch) return json(401, { detail: 'bad challenge' });
      challenges.delete(b.challenge_id as string); // single-use
      const presented = b.nonce ? decodeBase64(b.nonce) : new Uint8Array();
      if (encodeBase64(presented) !== encodeBase64(ch.nonce)) return json(401, { detail: 'bad nonce' });
      if (!accounts.has(ch.pub)) return json(401, { detail: 'no account' });
      const token = 'tok-' + ++counter;
      sessions.set(token, ch.pub);
      return json(200, { access_token: token, account_id: 'acct-' + ch.pub.slice(0, 6) });
    }

    // Snapshot PUT/GET (auth required).
    if (path === '/v1/sync/snapshot') {
      const auth = (init?.headers ?? {})['Authorization'] ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
      const pub = sessions.get(token);
      if (!pub) return json(401, { detail: 'unauth' });

      if (method === 'PUT') {
        const b = JSON.parse(init?.body ?? '{}') as {
          blob: string;
          updated_at: string;
          size: number;
          device_id: string;
        };
        // Store the RAW ciphertext bytes verbatim (server treats as opaque).
        snapshots.set(pub, {
          blob: decodeBase64(b.blob),
          updated_at: b.updated_at,
          size: b.size,
          device_id: b.device_id,
        });
        return json(200, {
          status: 'ok',
          meta: { updated_at: b.updated_at, size: b.size, device_id: b.device_id },
        });
      }
      if (method === 'GET') {
        const snap = snapshots.get(pub);
        if (!snap) return json(404, { detail: 'no snapshot' });
        return json(200, {
          blob: encodeBase64(snap.blob), // byte-identical echo
          updated_at: snap.updated_at,
          size: snap.size,
          device_id: snap.device_id,
        });
      }
    }

    return json(404, { detail: 'not found' });
  };

  return { fetchImpl, requests, snapshots };
}

describe('sync client (Phase 3 — server-backed E2E sync)', () => {
  it('refuses to push or pull while sync is OFF (opt-in gate)', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    const master = await getOrCreateMasterKeyPair();
    const server = makeFakeServer();
    const cfg: SyncConfig = {
      baseUrl: 'http://sync.test',
      deviceId: 'iphone-1',
      master,
      fetchImpl: server.fetchImpl,
    };

    // Default settings → syncEnabled is false.
    await expect(pushSnapshot(a.db, cfg)).rejects.toBeInstanceOf(SyncDisabledError);
    await expect(pullSnapshot(a.db, cfg)).rejects.toBeInstanceOf(SyncDisabledError);
    // And nothing was sent over the wire.
    expect(server.requests.length).toBe(0);

    a.sqlite.close();
  });

  it('push request carries ONLY ciphertext + metadata + token — never the private key or plaintext tables', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();
    const server = makeFakeServer();
    const cfg: SyncConfig = {
      baseUrl: 'http://sync.test',
      deviceId: 'iphone-1',
      master,
      fetchImpl: server.fetchImpl,
    };

    const result = await pushSnapshot(a.db, cfg);
    expect(result.deviceId).toBe('iphone-1');

    // Find the snapshot PUT request.
    const put = server.requests.find(
      (r) => r.method === 'PUT' && r.url.includes('/v1/sync/snapshot'),
    );
    expect(put).toBeDefined();
    const putBody = put?.body ?? '';

    // It carries the auth token (Bearer), and a JSON body with exactly the
    // expected opaque + metadata fields.
    expect(put?.headers['Authorization']).toMatch(/^Bearer /);
    const parsedBody = JSON.parse(putBody) as Record<string, unknown>;
    expect(Object.keys(parsedBody).sort()).toEqual(
      ['blob', 'device_id', 'size', 'updated_at'].sort(),
    );

    // The private key must NOT appear anywhere across ALL requests sent.
    const allText = JSON.stringify(server.requests);
    expect(allText.includes(master.privateKey)).toBe(false);
    // Nor the raw private-key bytes inside the (base64) blob the server stored.
    const stored = server.snapshots.get(master.publicKey);
    expect(stored).toBeDefined();
    const keyBytes = decodeBase64(master.privateKey);
    expect(containsSubsequence(stored!.blob, keyBytes)).toBe(false);

    // Plaintext health markers must NOT appear in any request body (the blob is
    // ciphertext; the only public key sent for registration carries no health data).
    expect(allText.includes('TOPSECRET-WIN-MARKER')).toBe(false);
    expect(allText.includes('TOPSECRET-SITUATION-MARKER')).toBe(false);
    expect(allText.includes('омлет из трёх яиц')).toBe(false);

    a.sqlite.close();
  });

  it('push → pull round-trips the full DB through the encrypted snapshot', async () => {
    // Device A: seed + push.
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();
    const before = dumpAll(a.sqlite);
    for (const t of backupTableNames()) {
      expect((before[t] as unknown[]).length).toBeGreaterThan(0);
    }

    const server = makeFakeServer();
    const cfgA: SyncConfig = {
      baseUrl: 'http://sync.test',
      deviceId: 'device-a',
      master,
      fetchImpl: server.fetchImpl,
    };
    await pushSnapshot(a.db, cfgA);

    // Device B: SAME master key (e.g. restored via iCloud/recovery), empty DB, pull.
    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    await grantSyncConsent(b.db);
    const cfgB: SyncConfig = {
      baseUrl: 'http://sync.test',
      deviceId: 'device-b',
      master, // same keypair → can decrypt A's snapshot
      fetchImpl: server.fetchImpl,
    };
    const pulled = await pullSnapshot(b.db, cfgB);
    expect(pulled.kind).toBe('imported');

    // Every table converged byte-for-byte (settings row differs only by sync
    // consent fields written on B, so compare the data tables that A seeded).
    const after = dumpAll(b.sqlite);
    for (const t of backupTableNames()) {
      if (t === 'app_settings') continue; // see note above
      expect(after[t]).toEqual(before[t]);
    }
    // The food/diary data made it across, proving real decryption of the snapshot.
    const winRow = b.sqlite.prepare('SELECT message FROM wins').get() as { message: string };
    expect(winRow.message).toContain('walked 8000 steps');

    a.sqlite.close();
    b.sqlite.close();
  });

  it('pull returns empty when the server has no snapshot (404)', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();
    const server = makeFakeServer();
    const cfg: SyncConfig = {
      baseUrl: 'http://sync.test',
      deviceId: 'iphone-1',
      master,
      fetchImpl: server.fetchImpl,
    };
    const pulled = await pullSnapshot(a.db, cfg);
    expect(pulled.kind).toBe('empty');
    a.sqlite.close();
  });

  it('a FOREIGN snapshot (sealed to a different key) fails to decrypt on pull', async () => {
    // Device A pushes a snapshot sealed to ITS key.
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    const masterA = await getOrCreateMasterKeyPair();
    const server = makeFakeServer();
    await pushSnapshot(a.db, {
      baseUrl: 'http://sync.test',
      deviceId: 'device-a',
      master: masterA,
      fetchImpl: server.fetchImpl,
    });

    // An attacker/other device with a DIFFERENT key registers and tries to pull A's
    // blob. The fake server keys snapshots by public key, so to force the
    // cross-key case we copy A's stored blob under B's account, then pull as B.
    const otherPriv = encodeBase64(nacl.box.keyPair().secretKey);
    const masterB = { privateKey: otherPriv, publicKey: derivesPub(otherPriv) };
    const storedA = server.snapshots.get(masterA.publicKey)!;
    server.snapshots.set(masterB.publicKey, { ...storedA });

    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    await grantSyncConsent(b.db);
    // B's key cannot open A's snapshot → decrypt throws, local DB untouched.
    await expect(
      pullSnapshot(b.db, {
        baseUrl: 'http://sync.test',
        deviceId: 'device-b',
        master: masterB,
        fetchImpl: server.fetchImpl,
      }),
    ).rejects.toThrow();

    a.sqlite.close();
    b.sqlite.close();
  });

  it('a TAMPERED snapshot blob fails to decrypt on pull', async () => {
    const a = makeDb();
    await applySchema((stmt) => a.sqlite.exec(stmt));
    await seed(a.db);
    await grantSyncConsent(a.db);
    const master = await getOrCreateMasterKeyPair();
    const server = makeFakeServer();
    const cfg: SyncConfig = {
      baseUrl: 'http://sync.test',
      deviceId: 'iphone-1',
      master,
      fetchImpl: server.fetchImpl,
    };
    await pushSnapshot(a.db, cfg);

    // Corrupt the stored ciphertext (flip bytes deep in the body, past the JSON
    // envelope) — decryption must fail, not silently import garbage.
    const stored = server.snapshots.get(master.publicKey)!;
    const tampered = Uint8Array.from(stored.blob);
    for (let i = tampered.length - 20; i < tampered.length; i++) tampered[i] ^= 0xff;
    server.snapshots.set(master.publicKey, { ...stored, blob: tampered });

    const b = makeDb();
    await applySchema((stmt) => b.sqlite.exec(stmt));
    await grantSyncConsent(b.db);
    await expect(pullSnapshot(b.db, cfg)).rejects.toThrow();

    a.sqlite.close();
    b.sqlite.close();
  });
});

/// Derive a base64 public key from a base64 private key (X25519) — test helper.
function derivesPub(privB64: string): string {
  return encodeBase64(nacl.box.keyPair.fromSecretKey(decodeBase64(privB64)).publicKey);
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
