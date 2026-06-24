import { solveChallenge } from '../crypto/e2ee';

import type { DataSyncProvider, SnapshotMeta, SnapshotPayload } from './dataSyncProvider';
import type { MasterKeyPair } from './syncClient';

/**
 * Legacy operator-server transport as a [DataSyncProvider] (platform-native-sync,
 * items 1 + 6). This is the FastAPI `sync-server/` path — pushed/pulled over HTTP,
 * authenticated by proving possession of the master PRIVATE key LOCALLY
 * (`solveChallenge`; the key is never transmitted).
 *
 * ⚠️ DEV-ONLY / DEPRECATED. Per ADR-2026-06-23 the product path rides the user's
 * platform account (CloudKit / Drive App Data); this operator server is kept as
 * reference + a developer fallback ONLY and is **default OFF**. Production builds
 * select the platform provider (or the unavailable provider) — never this one. See
 * `syncClient.getDataSyncProvider`. Do NOT deploy `sync-server/`.
 *
 * E2E invariant unchanged: the request body carries only the OPAQUE ciphertext
 * blob + non-secret metadata + a Bearer token; no plaintext, no private key.
 */

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

export interface ServerSyncConfig {
  /// Base URL of the sync server, e.g. "https://sync.driftora.app". No trailing slash.
  baseUrl: string;
  /// Stable opaque identifier for this device (NOT PII the server interprets).
  deviceId: string;
  /// The device master keypair (public key = what snapshots are sealed to; private
  /// key is used ONLY locally to solve the login challenge, never sent).
  master: MasterKeyPair;
  /// Injectable transport. Defaults to the global `fetch` on device.
  fetchImpl?: FetchLike;
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

function resolveFetch(cfg: ServerSyncConfig): FetchLike {
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
export async function authenticate(cfg: ServerSyncConfig): Promise<string> {
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
 * Builds the dev-only operator-server [DataSyncProvider]. The blob is built and
 * decrypted by `syncClient` — this provider only carries the opaque bytes over HTTP.
 */
export function createServerDataSyncProvider(cfg: ServerSyncConfig): DataSyncProvider {
  return {
    kind: 'server',
    // A configured server is "available" as a transport (reachability is surfaced
    // as a SyncError at push/pull time, not here).
    async isAvailableAsync() {
      return true;
    },

    async pushSnapshot(blobB64: string, meta: SnapshotMeta): Promise<SnapshotMeta> {
      const fetchImpl = resolveFetch(cfg);
      const token = await authenticate(cfg);
      const resp = await fetchImpl(`${cfg.baseUrl}/v1/sync/snapshot`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          blob: blobB64,
          updated_at: meta.updatedAt,
          size: meta.size,
          // This transport owns device identity (from its config), not the caller.
          device_id: cfg.deviceId,
        }),
      });
      if (!resp.ok) {
        throw new SyncError('sync: snapshot upload failed', resp.status);
      }
      const out = (await resp.json()) as {
        meta?: { updated_at: string; size: number; device_id: string };
      };
      const m = out.meta ?? { updated_at: meta.updatedAt, size: meta.size, device_id: cfg.deviceId };
      return { updatedAt: m.updated_at, size: m.size, deviceId: m.device_id };
    },

    async pullSnapshot(): Promise<SnapshotPayload | null> {
      const fetchImpl = resolveFetch(cfg);
      const token = await authenticate(cfg);
      const resp = await fetchImpl(`${cfg.baseUrl}/v1/sync/snapshot`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.status === 404) {
        return null;
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
      return {
        blobB64: body.blob,
        meta: {
          updatedAt: body.updated_at ?? '',
          size: body.size ?? 0,
          deviceId: body.device_id ?? '',
        },
      };
    },
  };
}
