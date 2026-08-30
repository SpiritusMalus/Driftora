import { eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { getRandomBytes } from 'expo-crypto';

import { appSettings } from '../db/schema';
import { ensureSettingsUnlocked } from '../db/settings';
import { withDbLock } from '../db/tx';

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
/** The in-flight (or finished) get-or-create, so callers can WAIT for the id
 *  instead of racing it. Set by the first `ensureInstallId`. */
let _ready: Promise<string> | null = null;

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
 *  synchronous request-header path.
 *
 *  Read-check-then-write as ONE queued unit (lib/core/db/tx.ts), for the two
 *  reasons the queue exists. Split across two trips it was the last write in the
 *  app issued outside the queue — a bare UPDATE landing while a neighbouring
 *  transaction is open joins that transaction and disappears with its rollback.
 *  And two callers racing (a provider remount) both read "no id yet" and mint
 *  their own: the row keeps the loser's, `_cached` may hold the winner's, and the
 *  id the server meters this install by changes on the next launch — which is
 *  the whole point of a stable install id. Uses `ensureSettingsUnlocked`: the
 *  locked variant would wait for the lock this already holds. */
export async function ensureInstallId(db: AnyDb): Promise<string> {
  _ready = mintInstallId(db);
  return _ready;
}

async function mintInstallId(db: AnyDb): Promise<string> {
  return withDbLock(
    db,
    async () => {
      const settings = await ensureSettingsUnlocked(db);
      const existing = settings.installId;
      if (typeof existing === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(existing)) {
        _cached = existing;
        return existing;
      }
      const id = newInstallId();
      await db.update(appSettings).set({ installId: id }).where(eq(appSettings.id, 0));
      _cached = id;
      return id;
    },
    'ensureInstallId',
  );
}

/** Synchronous view for header builders; null until `ensureInstallId` ran
 *  (requests then just fall back to the server's ip-scoped bucket). */
export function getCachedInstallId(): string | null {
  return _cached;
}

/**
 * ИДЕНТИФИКАТОР — ПРЕДУСЛОВИЕ ЗАПРОСА, А НЕ ПОБОЧНЫЙ ЭФФЕКТ СТАРТА.
 *
 * Чеканка id идёт fire-and-forget при инициализации БД, и синхронный
 * `getCachedInstallId` до её конца отдавал null: запрос уходил БЕЗ заголовка и
 * попадал в общую по адресу корзину — ровно то, ради чего id и заводился (на
 * проде это видно как `ip_fallback_active` при нулевых `installs_active`).
 * Здесь запрос ЖДЁТ уже идущую чеканку — но не дольше `timeoutMs`: заблокировать
 * еду из-за счётчика было бы хуже той самой корзины, поэтому по истечении срока
 * (или если чеканка ещё не начиналась) отдаём что есть, обычно null.
 */
export async function whenInstallId(timeoutMs = 3000): Promise<string | null> {
  if (_cached) return _cached;
  if (!_ready) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      _ready.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
