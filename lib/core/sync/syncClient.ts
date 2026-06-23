import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

import { solveChallenge } from '../crypto/e2ee';
import { exportAllTables, importAllTables, type BackupDocument } from '../db/backup';
import { buildBackupFile, decryptBackupBody, parseBackupFile } from '../db/backupFile';
import { ensureSettings } from '../db/settings';

/**
 * Client sync layer (Driftora Phase 3) — pushes an encrypted full-DB snapshot
 * to the `sync-server/` and pulls it on another device. Last-writer-wins.
 *
 * E2E INVARIANT (asserted in `__tests__/syncClient.test.ts`): the only things that
 * leave the device are (a) OPAQUE CIPHERTEXT — `buildBackupFile` output sealed to
 * the master PUBLIC key — (b) non-secret METADATA, and (c) the session token. The
 * master PRIVATE key NEVER appears in any request body or header: it is used only
 * locally, inside `solveChallenge`, to prove possession during login. The server
 * stores ciphertext it cannot read.
 *
 * The whole thing is OPT-IN: every entry point calls `assertSyncEnabled`, which
 * throws unless the user turned sync on (default OFF), exactly like the food→AI
 * consent gate. Local SQLite stays the source of truth; sync is a layer on top.
 *
 * Crypto + DB logic is REUSED, not reinvented: `e2ee.solveChallenge`,
 * `backupFile.{buildBackupFile,parseBackupFile,decryptBackupBody}`,
 * `backup.{exportAllTables,importAllTables}`. This module is just the wire glue +
 * the auth handshake, kept pure (injectable `fetch`) so it unit-tests in node.
 */

/// Accepts any drizzle SQLite database (op-sqlite on device, better-sqlite3 in tests).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// The master keypair this device holds (from `keystore.getOrCreateMasterKeyPair`).
/// Passed in (not imported) so the sync layer never reaches into secure-store
/// itself — the caller owns key custody, keeping this module pure + testable.
export interface MasterKeyPair {
  publicKey: string; // base64
  privateKey: string; // base64 — used ONLY locally; never sent over the wire
}

/// Minimal `fetch` surface we depend on, so tests can inject a mock transport.
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export interface SyncConfig {
  /// Base URL of the sync server, e.g. "https://sync.driftora.app". No trailing slash.
  baseUrl: string;
  /// Stable opaque identifier for this device (NOT PII the server interprets).
  deviceId: string;
  /// The device master keypair (public key = what snapshots are sealed to).
  master: MasterKeyPair;
  /// Injectable transport. Defaults to the global `fetch` on device.
  fetchImpl?: FetchLike;
}

/// Thrown when sync is attempted while the opt-in is OFF. Distinct type so callers
/// (and tests) can tell "user hasn't enabled sync" apart from a network/auth error.
export class SyncDisabledError extends Error {
  constructor() {
    super('sync: disabled (the user has not opted in to server-backed sync)');
    this.name = 'SyncDisabledError';
  }
}

/// Thrown for any server/transport/auth failure, carrying the HTTP status when known.
export class SyncError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SyncError';
    this.status = status;
  }
}

/// Result of a push: the metadata the server echoed back.
export interface PushResult {
  updatedAt: string;
  size: number;
  deviceId: string;
}

/// Result of a pull: whether a snapshot existed and was imported.
export type PullResult =
  | { kind: 'imported'; updatedAt: string; size: number; deviceId: string }
  | { kind: 'empty' }; // server has no snapshot yet (404)

/**
 * Throws [SyncDisabledError] unless the user has opted in to sync. The gate is the
 * persisted `syncEnabled` flag alone (NOT the version) so revoking consent stops
 * transfers immediately. Call at the top of every transfer entry point.
 */
export async function assertSyncEnabled(db: AnyDb): Promise<void> {
  const settings = await ensureSettings(db);
  if (!settings.syncEnabled) {
    throw new SyncDisabledError();
  }
}

function resolveFetch(cfg: SyncConfig): FetchLike {
  const f = cfg.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!f) {
    throw new SyncError('sync: no fetch implementation available');
  }
  return f;
}

/**
 * Registers this device's account (idempotent server-side) and logs in by key,
 * returning a session token. ONLY the public key is sent for registration; login
 * proves possession of the PRIVATE key by solving the server's challenge LOCALLY
 * (`solveChallenge`) — the private key is never transmitted.
 */
export async function authenticate(cfg: SyncConfig): Promise<string> {
  const fetchImpl = resolveFetch(cfg);
  const pub = cfg.master.publicKey;

  // 1. Register (idempotent): store the PUBLIC key. No password, no private key.
  const reg = await fetchImpl(`${cfg.baseUrl}/v1/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_key: pub, device_id: cfg.deviceId }),
  });
  if (!reg.ok) {
    throw new SyncError(`sync: account registration failed`, reg.status);
  }

  // 2. Ask for a challenge: the server returns a nonce encrypted to our public key.
  const challengeResp = await fetchImpl(
    `${cfg.baseUrl}/v1/auth/challenge?public_key=${encodeURIComponent(pub)}`,
    { method: 'GET' },
  );
  if (!challengeResp.ok) {
    throw new SyncError('sync: could not get auth challenge', challengeResp.status);
  }
  const challenge = (await challengeResp.json()) as {
    challenge_id?: string;
    encrypted_challenge?: string;
  };
  if (!challenge.challenge_id || !challenge.encrypted_challenge) {
    throw new SyncError('sync: malformed auth challenge');
  }

  // 3. Solve it LOCALLY with the private key (never sent) and return the nonce.
  const nonce = solveChallenge(challenge.encrypted_challenge, cfg.master.privateKey);

  // 4. Log in with the solved nonce → session token.
  const loginResp = await fetchImpl(`${cfg.baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge_id: challenge.challenge_id, nonce }),
  });
  if (!loginResp.ok) {
    throw new SyncError('sync: login by key failed', loginResp.status);
  }
  const login = (await loginResp.json()) as { access_token?: string };
  if (!login.access_token) {
    throw new SyncError('sync: login returned no token');
  }
  return login.access_token;
}

/**
 * Pushes the full DB as an encrypted snapshot. Pipeline:
 *   exportAllTables → buildBackupFile(sealed to master PUBLIC key) → base64 →
 *   PUT /v1/sync/snapshot (Bearer token).
 *
 * The request body carries ONLY the ciphertext blob + metadata; the auth is a
 * Bearer token. No plaintext table data and no private key ever leave the device.
 *
 * @throws [SyncDisabledError] if sync is off, [SyncError] on transport/auth failure.
 */
export async function pushSnapshot(db: AnyDb, cfg: SyncConfig): Promise<PushResult> {
  await assertSyncEnabled(db);
  const fetchImpl = resolveFetch(cfg);

  const doc = await exportAllTables(db);
  // Seal to the master PUBLIC key (no recovery header needed for sync — the device
  // already holds the key; recovery is the local-backup story).
  const fileBytes = await buildBackupFile(doc, cfg.master);
  const blobB64 = encodeBase64(fileBytes);

  const token = await authenticate(cfg);
  const resp = await fetchImpl(`${cfg.baseUrl}/v1/sync/snapshot`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      blob: blobB64,
      updated_at: doc.exportedAt,
      size: fileBytes.length,
      device_id: cfg.deviceId,
    }),
  });
  if (!resp.ok) {
    throw new SyncError('sync: snapshot upload failed', resp.status);
  }
  const out = (await resp.json()) as { meta?: { updated_at: string; size: number; device_id: string } };
  const meta = out.meta ?? { updated_at: doc.exportedAt, size: fileBytes.length, device_id: cfg.deviceId };
  return { updatedAt: meta.updated_at, size: meta.size, deviceId: meta.device_id };
}

/**
 * Pulls the latest snapshot and imports it. Pipeline:
 *   GET /v1/sync/snapshot (Bearer token) → base64-decode → parseBackupFile →
 *   decryptBackupBody(master PRIVATE key) → importAllTables (replace-all).
 *
 * Decryption happens entirely on-device with the private key. A snapshot the
 * device's key can't open (tampered, or sealed to a different key) throws rather
 * than corrupting the local DB. A 404 (server has nothing yet) returns `empty`.
 *
 * @throws [SyncDisabledError] if sync is off, [SyncError] on transport/auth
 *   failure, or the underlying decrypt/parse error if the blob can't be opened.
 */
export async function pullSnapshot(db: AnyDb, cfg: SyncConfig): Promise<PullResult> {
  await assertSyncEnabled(db);
  const fetchImpl = resolveFetch(cfg);

  const token = await authenticate(cfg);
  const resp = await fetchImpl(`${cfg.baseUrl}/v1/sync/snapshot`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) {
    return { kind: 'empty' };
  }
  if (!resp.ok) {
    throw new SyncError('sync: snapshot download failed', resp.status);
  }
  const body = (await resp.json()) as {
    blob?: string;
    updated_at?: string;
    size?: number;
    device_id?: string;
  };
  if (!body.blob) {
    throw new SyncError('sync: snapshot response missing blob');
  }

  const fileBytes = decodeBase64(body.blob);
  const parsed = parseBackupFile(fileBytes);
  // Decrypt locally with the PRIVATE key. Throws on a wrong/foreign/tampered blob.
  const doc: BackupDocument = decryptBackupBody(parsed, cfg.master.privateKey);
  await importAllTables(db, doc);

  return {
    kind: 'imported',
    updatedAt: body.updated_at ?? '',
    size: body.size ?? fileBytes.length,
    deviceId: body.device_id ?? '',
  };
}
