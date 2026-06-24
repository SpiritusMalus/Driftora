import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

import { exportAllTables, importAllTables, type BackupDocument } from '../db/backup';
import { buildBackupFile, decryptBackupBody, parseBackupFile } from '../db/backupFile';
import { ensureSettings } from '../db/settings';

import {
  getPlatformDataSyncProvider,
  unavailableDataSyncProvider,
  type DataSyncProvider,
  type SnapshotMeta,
  type SnapshotPayload,
} from './dataSyncProvider';
import {
  createServerDataSyncProvider,
  SyncError,
  type FetchLike,
  type ServerSyncConfig,
} from './serverDataSyncProvider';

/**
 * Client sync layer (Driftora). Splits cleanly into two halves:
 *   - the CRYPTO/DB half (this file): export the DB → seal it to the master PUBLIC
 *     key (`buildBackupFile`) → base64; and the reverse on pull (parse → decrypt
 *     with the PRIVATE key → import). This half never touches the network.
 *   - the TRANSPORT half (`dataSyncProvider.ts`): a content-blind `DataSyncProvider`
 *     that carries the opaque blob to/from a store. Per ADR-2026-06-23 the product
 *     transport rides the user's platform account (CloudKit / Drive App Data); the
 *     legacy operator server is a dev-only fallback (`serverDataSyncProvider.ts`).
 *
 * E2E INVARIANT (asserted in `__tests__/syncClient.test.ts` + `dataSyncProvider.test.ts`):
 * the only things that cross the provider boundary are (a) OPAQUE CIPHERTEXT sealed
 * to the master PUBLIC key and (b) non-secret METADATA. The master PRIVATE key NEVER
 * appears in a provider call or request body; it is used only locally (decrypt on
 * pull, and the server provider's challenge-solve on login).
 *
 * The whole thing is OPT-IN: every transfer calls `assertSyncEnabled`, which throws
 * unless the user turned sync on (default OFF). Local SQLite stays the source of
 * truth; sync is a layer on top.
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

// Re-exported for backward compatibility with existing callers/tests that imported
// these from `syncClient` before the transport seam was extracted.
export { SyncError, type FetchLike };
export type SyncConfig = ServerSyncConfig;

/// Thrown when sync is attempted while the opt-in is OFF. Distinct type so callers
/// (and tests) can tell "user hasn't enabled sync" apart from a network/auth error.
export class SyncDisabledError extends Error {
  constructor() {
    super('sync: disabled (the user has not opted in to server-backed sync)');
    this.name = 'SyncDisabledError';
  }
}

/// Result of a push: the metadata the transport echoed back.
export type PushResult = SnapshotMeta;

/// Result of a pull: whether a snapshot existed and was imported.
export type PullResult =
  | { kind: 'imported'; updatedAt: string; size: number; deviceId: string }
  | { kind: 'empty' }; // store has no snapshot yet

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

/**
 * The crypto half of a push: export every table and SEAL it to the master PUBLIC
 * key. The result is opaque ciphertext + non-secret metadata, ready to hand to any
 * transport. No recovery header (the device already holds the key; recovery is the
 * local-backup story).
 */
async function buildSnapshot(db: AnyDb, master: MasterKeyPair): Promise<SnapshotPayload> {
  const doc = await exportAllTables(db);
  const fileBytes = await buildBackupFile(doc, master);
  return {
    blobB64: encodeBase64(fileBytes),
    // `updatedAt` = client export clock → the last-writer-wins key. `deviceId` is
    // filled by transports that own device identity (e.g. the server provider).
    meta: { updatedAt: doc.exportedAt, size: fileBytes.length, deviceId: '' },
  };
}

/**
 * The crypto half of a pull: decode → parse → DECRYPT with the PRIVATE key → import
 * (replace-all). Decryption happens entirely on-device. A blob the device's key
 * can't open (tampered, or sealed to a different key) throws rather than corrupting
 * the local DB.
 */
async function applySnapshot(
  db: AnyDb,
  master: MasterKeyPair,
  payload: SnapshotPayload,
): Promise<void> {
  const fileBytes = decodeBase64(payload.blobB64);
  const parsed = parseBackupFile(fileBytes);
  const doc: BackupDocument = decryptBackupBody(parsed, master.privateKey);
  await importAllTables(db, doc);
}

/**
 * Push the full DB as an encrypted snapshot through any [DataSyncProvider].
 * Pipeline: assertSyncEnabled → buildSnapshot (seal to PUBLIC key) →
 * provider.pushSnapshot(blob, meta). Only ciphertext + metadata cross the boundary.
 *
 * @throws [SyncDisabledError] if sync is off; the provider's error on transport
 *   failure.
 */
export async function pushVia(
  db: AnyDb,
  master: MasterKeyPair,
  provider: DataSyncProvider,
): Promise<PushResult> {
  await assertSyncEnabled(db);
  const { blobB64, meta } = await buildSnapshot(db, master);
  return provider.pushSnapshot(blobB64, meta);
}

/**
 * Pull the latest snapshot through any [DataSyncProvider] and import it. Pipeline:
 * assertSyncEnabled → provider.pullSnapshot → applySnapshot (decrypt with PRIVATE
 * key → replace-all). A store with nothing yet returns `empty`.
 *
 * @throws [SyncDisabledError] if sync is off; the provider's error on transport
 *   failure; or the decrypt/parse error if the blob can't be opened.
 */
export async function pullVia(
  db: AnyDb,
  master: MasterKeyPair,
  provider: DataSyncProvider,
): Promise<PullResult> {
  await assertSyncEnabled(db);
  const payload = await provider.pullSnapshot();
  if (!payload) {
    return { kind: 'empty' };
  }
  await applySnapshot(db, master, payload);
  return {
    kind: 'imported',
    updatedAt: payload.meta.updatedAt,
    size: payload.meta.size,
    deviceId: payload.meta.deviceId,
  };
}

/// Selection inputs for [getDataSyncProvider].
export interface DataSyncSelection {
  /// Dev-only: a configured operator server to fall back to. Ignored unless
  /// `allowDevServer` is true (default false → the deprecated server is NEVER
  /// selected in production, per ADR-2026-06-23 / item 6).
  devServer?: ServerSyncConfig;
  allowDevServer?: boolean;
}

/**
 * Choose the transport for this device: the platform-native provider when it's
 * available (CloudKit on iOS / Drive App Data on Android, once items 2/4 land),
 * else the dev-only operator server **only if explicitly allowed**, else the
 * unavailable provider (caller falls back to the manual backup file + phrase).
 */
export async function getDataSyncProvider(
  opts: DataSyncSelection = {},
): Promise<DataSyncProvider> {
  const platform = getPlatformDataSyncProvider();
  if (await platform.isAvailableAsync()) {
    return platform;
  }
  if (opts.allowDevServer && opts.devServer) {
    return createServerDataSyncProvider(opts.devServer);
  }
  return unavailableDataSyncProvider;
}

// ---------------------------------------------------------------------------
// Backward-compatible config wrappers (DEV-ONLY operator-server path).
// These build a server `DataSyncProvider` from a `SyncConfig` and delegate to the
// provider-driven core above. Production code should call `getDataSyncProvider`
// instead — the server is a deprecated fallback (ADR-2026-06-23 / item 6).
// ---------------------------------------------------------------------------

/**
 * Pushes the full DB as an encrypted snapshot to the operator server. DEV-ONLY.
 * @throws [SyncDisabledError] if sync is off, [SyncError] on transport/auth failure.
 */
export async function pushSnapshot(db: AnyDb, cfg: SyncConfig): Promise<PushResult> {
  return pushVia(db, cfg.master, createServerDataSyncProvider(cfg));
}

/**
 * Pulls the latest snapshot from the operator server and imports it. DEV-ONLY.
 * @throws [SyncDisabledError] if sync is off, [SyncError] on transport/auth failure,
 *   or the decrypt/parse error if the blob can't be opened.
 */
export async function pullSnapshot(db: AnyDb, cfg: SyncConfig): Promise<PullResult> {
  return pullVia(db, cfg.master, createServerDataSyncProvider(cfg));
}
