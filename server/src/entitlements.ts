import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Request } from 'express';
import { installIdOf } from './installQuota.js';

/**
 * Who is allowed the PAID AI budget — the half of monetization the quota meter
 * cannot answer on its own.
 *
 * WHY A SEPARATE NOTION OF IDENTITY: installQuota.ts:15 is blunt about it — the
 * `X-Install-Id` header is client-generated and therefore spoofable. It is fine
 * as a METER (an honest app counts its own spend) and useless as a RIGHT (an
 * abuser rotates ids). So the right lives in the purchase token, which only the
 * store can mint and only the store can validate; the install id is merely what
 * that token is currently bound to.
 *
 * THE STORE IS THE SOURCE OF TRUTH, THIS IS A CACHE. Verification is injected
 * (`PurchaseVerifier`), so the Google Play adapter is one file and swapping or
 * adding a store never touches this logic. What is cached is the verdict —
 * product, state and expiry — never the token itself: records are keyed by a
 * SHA-256 of the token, so a leaked entitlements file cannot be replayed against
 * the store as a purchase.
 *
 * PERSISTENT ON PURPOSE, unlike the quota. A forgotten quota counter costs a
 * user a few extra parses; a forgotten entitlement silently downgrades someone
 * who paid, on every deploy. Append-only JSONL + periodic atomic rewrite: the
 * volume here is one line per purchase event, not per request, and prod is Node
 * 20 (no `node:sqlite`), so this stays dependency-free.
 */

/** Lifecycle as this service cares about it — store vocabularies map onto this. */
export type EntitlementState = 'active' | 'grace' | 'paused' | 'expired' | 'revoked';

/** The store's verdict on one purchase token. */
export interface PurchaseVerification {
  productId: string;
  /** Epoch ms the paid period ends. 0 when the store did not say. */
  expiresAt: number;
  state: EntitlementState;
}

/**
 * Adapter to one store. Returns null when the token is not a purchase of ours —
 * forged, refunded into nothing, or belonging to another app. Throwing means
 * "could not reach the store", which is treated very differently: see `register`.
 */
export type PurchaseVerifier = (purchaseToken: string, productId: string) => Promise<PurchaseVerification | null>;

interface EntitlementRecord {
  tokenHash: string;
  productId: string;
  expiresAt: number;
  state: EntitlementState;
  /** Bound installs, oldest first — the array doubles as the eviction queue. */
  installIds: string[];
  updatedAt: number;
}

/**
 * One subscription covers a person, and a person owns phones over time: a new
 * device, a reinstall, a tablet. Binding is therefore many-installs-to-one-token
 * with an LRU cap rather than a hard rejection — a hard cap would lock a paying
 * user out of their own new phone, which is a worse failure than the abuse it
 * prevents. Sharing one purchase with a crowd still bounces off the ceiling.
 */
const MAX_INSTALLS_PER_TOKEN = 5;

/**
 * REFRESH IS THE CLIENT'S JOB, and it cannot be anything else: we store a hash
 * of the purchase token, never the token, so this service physically cannot
 * re-ask the store about a purchase on its own. The client holds the real token
 * (the store SDK hands it over on every launch) and re-registers, which is what
 * turns a refund or revocation into an ended entitlement here.
 *
 * Consequence to accept knowingly: between a refund and the user's next launch,
 * a cached verdict keeps the paid cap. That is a bounded amount of free AI, not
 * an open door — and the alternative (storing replayable tokens) trades a real
 * security property for it. A store-to-server revocation feed (Google RTDN)
 * closes the gap later without changing this file's shape.
 *
 * A cancellation is NOT a revocation: the paid period was bought and is honoured
 * to `expiresAt`.
 */

/** Compaction trigger: rewrite once the log is mostly superseded lines. */
const COMPACT_RATIO = 4;

export interface EntitlementsOptions {
  /** JSONL path. Empty string keeps everything in memory (tests). */
  path?: string;
  verify: PurchaseVerifier;
  now?: () => number;
  maxInstalls?: number;
}

export interface RegisterResult {
  ok: boolean;
  active: boolean;
  expiresAt: number;
  state: EntitlementState | 'unknown';
  reason?: 'invalid_purchase' | 'store_unreachable';
}

export interface Entitlements {
  register: (purchaseToken: string, productId: string, installId: string) => Promise<RegisterResult>;
  /** Paid status of the caller — what the quota consults for its cap. */
  isPaid: (req: Request) => boolean;
  statusOf: (installId: string | null) => { active: boolean; expiresAt: number; state: EntitlementState | 'none' };
  /** Aggregate-only snapshot for /metrics — never a token, hash or install id. */
  snapshot: () => Record<string, unknown>;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createEntitlements(opts: EntitlementsOptions): Entitlements {
  const now = opts.now ?? Date.now;
  const maxInstalls = opts.maxInstalls ?? MAX_INSTALLS_PER_TOKEN;
  const path = opts.path ?? process.env.ENTITLEMENTS_PATH ?? '';

  const byToken = new Map<string, EntitlementRecord>();
  const byInstall = new Map<string, string>(); // install id → tokenHash
  let appended = 0;
  let registrations = 0;
  let rejected = 0;
  let unreachable = 0;

  function index(rec: EntitlementRecord): void {
    byToken.set(rec.tokenHash, rec);
    for (const id of rec.installIds) byInstall.set(id, rec.tokenHash);
  }

  function load(): void {
    if (!path || !existsSync(path)) return;
    let lines: string[];
    try {
      lines = readFileSync(path, 'utf8').split('\n');
    } catch (err) {
      // A missing/unreadable file must not take the parse service down with it:
      // starting with an empty cache degrades paid users to the free tier until
      // their client re-registers, which is recoverable. Refusing to boot is not.
      console.error('entitlements: load failed:', err instanceof Error ? err.message : String(err));
      return;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as EntitlementRecord;
        if (typeof rec?.tokenHash === 'string' && Array.isArray(rec.installIds)) {
          // Last line wins: the log is a sequence of upserts, not a set.
          for (const [id, h] of byInstall) if (h === rec.tokenHash) byInstall.delete(id);
          index(rec);
          appended += 1;
        }
      } catch {
        // One corrupt line (a torn write on power loss) must not discard the
        // rest of the log — skip it and keep reading.
      }
    }
  }

  function persist(rec: EntitlementRecord): void {
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(rec)}\n`);
      appended += 1;
    } catch (err) {
      // In-memory state is already updated, so the user keeps what they paid
      // for until the next restart. Loud, because it WILL be forgotten on deploy.
      console.error('entitlements: persist failed:', err instanceof Error ? err.message : String(err));
      return;
    }
    // Separate try: a failed compaction leaves a correct (merely longer) log, and
    // reporting it as "persist failed" would send someone hunting for lost
    // purchases that were in fact written.
    if (appended > byToken.size * COMPACT_RATIO && appended > 64) {
      try {
        compact();
      } catch (err) {
        console.error('entitlements: compaction failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Rewrite the log as one line per record, atomically (tmp + rename). */
  function compact(): void {
    const tmp = `${path}.tmp`;
    const body = [...byToken.values()].map((r) => JSON.stringify(r)).join('\n');
    writeFileSync(tmp, body ? `${body}\n` : '');
    renameSync(tmp, path);
    appended = byToken.size;
  }

  function isActive(rec: EntitlementRecord, ms: number): boolean {
    if (rec.state === 'revoked' || rec.state === 'expired' || rec.state === 'paused') return false;
    // expiresAt 0 = the store did not say. Trust the state rather than expiring
    // a paying user on our own guess.
    return rec.expiresAt === 0 || rec.expiresAt > ms;
  }

  function statusOf(installId: string | null): {
    active: boolean;
    expiresAt: number;
    state: EntitlementState | 'none';
  } {
    if (!installId) return { active: false, expiresAt: 0, state: 'none' };
    const hash = byInstall.get(installId);
    const rec = hash ? byToken.get(hash) : undefined;
    if (!rec) return { active: false, expiresAt: 0, state: 'none' };
    return { active: isActive(rec, now()), expiresAt: rec.expiresAt, state: rec.state };
  }

  function isPaid(req: Request): boolean {
    return statusOf(installIdOf(req)).active;
  }

  async function register(purchaseToken: string, productId: string, installId: string): Promise<RegisterResult> {
    let verdict: PurchaseVerification | null;
    try {
      verdict = await opts.verify(purchaseToken, productId);
    } catch (err) {
      // Store unreachable ≠ purchase invalid. Conflating them would revoke every
      // paying user during a Google outage, so this keeps whatever is cached and
      // tells the client to retry rather than showing a "purchase failed" screen.
      unreachable += 1;
      console.error('entitlements: verify failed:', err instanceof Error ? err.message : String(err));
      const cached = statusOf(installId);
      return { ok: false, active: cached.active, expiresAt: cached.expiresAt, state: 'unknown', reason: 'store_unreachable' };
    }

    if (!verdict) {
      rejected += 1;
      return { ok: false, active: false, expiresAt: 0, state: 'expired', reason: 'invalid_purchase' };
    }

    const tokenHash = hashToken(purchaseToken);

    // An install is entitled by at most ONE purchase. Without this, a device that
    // renews under a fresh token stays listed in the old record as well, and the
    // in-memory mapping (newest wins) stops agreeing with what a restart would
    // rebuild from the log (file order wins) — a paid user could come back from a
    // deploy pointing at their previous, expired subscription.
    const previousHash = byInstall.get(installId);
    if (previousHash && previousHash !== tokenHash) {
      const previous = byToken.get(previousHash);
      if (previous) {
        previous.installIds = previous.installIds.filter((x) => x !== installId);
        previous.updatedAt = now();
        persist(previous);
      }
    }

    const existing = byToken.get(tokenHash);
    const installIds = existing ? existing.installIds.filter((x) => x !== installId) : [];
    installIds.push(installId);
    while (installIds.length > maxInstalls) {
      const evicted = installIds.shift();
      if (evicted !== undefined) byInstall.delete(evicted);
    }

    const rec: EntitlementRecord = {
      tokenHash,
      productId: verdict.productId,
      expiresAt: verdict.expiresAt,
      state: verdict.state,
      installIds,
      updatedAt: now(),
    };
    index(rec);
    persist(rec);
    registrations += 1;

    return { ok: true, active: isActive(rec, now()), expiresAt: rec.expiresAt, state: rec.state };
  }

  function snapshot(): Record<string, unknown> {
    const ms = now();
    let active = 0;
    for (const rec of byToken.values()) if (isActive(rec, ms)) active += 1;
    return {
      records: byToken.size,
      active,
      installs_bound: byInstall.size,
      registrations,
      rejected,
      store_unreachable: unreachable,
    };
  }

  load();

  return { register, isPaid, statusOf, snapshot };
}
