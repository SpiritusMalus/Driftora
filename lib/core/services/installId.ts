import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { getRandomBytes } from 'expo-crypto';

import { appSettings } from '../db/schema';
import { ensureSettings } from '../db/settings';

/**
 * Random per-install id for the server's AI-quota meter (the `X-Install-Id`
 * request header). NOT an account and NOT a device identifier: a 128-bit coin
 * flip, minted once, stored in app_settings, and sent only to the food server
 * alongside requests that already carry the meal content (same consent gate).
 * It lets the server budget AI parses per INSTALL instead of per IP — mobile
 * CGNAT puts hundreds of honest users behind one operator address, so per-IP
 * caps would start rejecting real people as the app grows.
 *
 * Restoring a backup restores the id (same person, same budget); a fresh
 * install just mints a new one.
 */

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests) — mirrors settings.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

let _cached: string | null = null;

/** 32 hex chars. The id is a meter key, not a secret — so when the native RNG
 *  is unavailable (bare env), Math.random is an acceptable fallback. */
export function newInstallId(): string {
  try {
    return Array.from(getRandomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let out = '';
    for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }
}

/** Get-or-create the persistent id (called once at DB init); caches for the
 *  synchronous request-header path. */
export async function ensureInstallId(db: AnyDb): Promise<string> {
  const settings = await ensureSettings(db);
  const existing = settings.installId;
  if (typeof existing === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(existing)) {
    _cached = existing;
    return existing;
  }
  const id = newInstallId();
  await db.update(appSettings).set({ installId: id }).where(eq(appSettings.id, 0));
  _cached = id;
  return id;
}

/** Synchronous view for header builders; null until `ensureInstallId` ran
 *  (requests then just fall back to the server's ip-scoped bucket). */
export function getCachedInstallId(): string | null {
  return _cached;
}
