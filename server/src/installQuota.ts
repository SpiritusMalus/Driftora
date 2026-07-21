import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Per-INSTALL daily quota for the LLM-backed parse endpoints — the fine-grained
 * layer the per-IP caps can't provide. Mobile CGNAT puts hundreds of honest
 * users behind one operator IP, so per-IP daily caps (rateLimit.ts) start
 * 429-ing real people as soon as a handful of them share an exit address;
 * rateLimit.ts:35 anticipated exactly this («precise per-device limiting is a
 * separate, larger task»). This is that task's first half: the client sends a
 * random `X-Install-Id` header (no account, no device identifier — a coin flip
 * stored in app_settings), and each install gets its own daily budget of AI
 * parses.
 *
 * HONEST THREAT MODEL: the id is client-generated and therefore spoofable — an
 * abuser can rotate ids. So this layer METERS honest apps (and later shapes
 * free/paid tiers); the coarser per-IP caps stay mounted as the abuse
 * backstop. Neither layer replaces the other.
 *
 * The counters also feed `/metrics` with an anonymous usage histogram — the
 * data that will eventually pick the free-tier size and the subscription
 * fair-use cap from observed behavior instead of guesswork.
 *
 * In-memory on purpose (single instance, same reasoning as rateLimit.ts); the
 * window is the UTC calendar day, and a restart forgiving today's spend is
 * acceptable slack, not a bug.
 */

/** Requests per install per UTC day across ALL AI parse routes (food text/photo/audio + workout). */
const DEFAULT_PER_DAY = 30;

/** Same /64 grouping as rateLimit.ts, for clients that don't send an id yet. */
const IPV6_SUBNET = 64;

/** Client-generated ids: hex/uuid-ish, bounded so the key store can't be ballooned. */
const INSTALL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Hard bound on tracked keys per day — far above any real install count. */
const MAX_KEYS = 50_000;

type FailFn = (res: Response, status: number, code: string, message: string) => void;

export interface InstallQuotaOptions {
  /** Override the per-day cap (tests use tiny values). 0 disables the quota. */
  perDay?: number;
  /** Injectable clock for deterministic day-rollover tests. */
  now?: () => number;
}

export interface InstallQuota {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Aggregate-only snapshot for /metrics — never contains an id. */
  snapshot: () => Record<string, unknown>;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** UTC day stamp — the quota window. */
function dayOf(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/** Seconds until the next UTC midnight, for an honest Retry-After. */
function secondsToReset(ms: number): number {
  return Math.max(1, Math.ceil(((dayOf(ms) + 1) * 86_400_000 - ms) / 1000));
}

export function createInstallQuota(fail: FailFn, opts: InstallQuotaOptions = {}): InstallQuota {
  const perDay = opts.perDay ?? envInt('AI_PER_INSTALL_PER_DAY', DEFAULT_PER_DAY);
  const now = opts.now ?? Date.now;

  // key → requests today. Insertion-ordered Map doubles as an eviction queue.
  const counts = new Map<string, number>();
  let currentDay = dayOf(now());
  let quotaHits = 0;

  function keyOf(req: Request): string {
    const raw = req.get('x-install-id') || '';
    if (INSTALL_ID_RE.test(raw)) return `id:${raw}`;
    // No (valid) id — an older client. Falling back to the IP key keeps the
    // quota meaningful during the transition without punishing anyone extra.
    return `ip:${ipKeyGenerator(req.ip ?? '', IPV6_SUBNET)}`;
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    if (perDay <= 0) return next(); // explicitly disabled

    const ms = now();
    const day = dayOf(ms);
    if (day !== currentDay) {
      currentDay = day;
      counts.clear();
    }

    const key = keyOf(req);
    const used = counts.get(key) ?? 0;
    if (used >= perDay) {
      quotaHits += 1;
      res.setHeader('X-AI-Quota-Remaining', '0');
      res.setHeader('Retry-After', String(secondsToReset(ms)));
      fail(res, 429, 'ai_quota_exceeded', 'Daily AI parse quota reached for this install.');
      return;
    }

    if (!counts.has(key) && counts.size >= MAX_KEYS) {
      const oldest = counts.keys().next().value;
      if (oldest !== undefined) counts.delete(oldest);
    }
    counts.set(key, used + 1);
    // The client shows a quiet «осталось N» once this runs low — the honest
    // alternative to a surprise 429 at the day's fifth meal.
    res.setHeader('X-AI-Quota-Remaining', String(perDay - used - 1));
    next();
  }

  function snapshot(): Record<string, unknown> {
    // Usage histogram over id-keyed installs only (ip-fallback keys are mixed
    // crowds behind CGNAT — counting them as "one install" would skew the very
    // distribution this exists to measure).
    const buckets = { '1-2': 0, '3-5': 0, '6-10': 0, '11-30': 0, '31+': 0 };
    let installs = 0;
    let ipFallback = 0;
    for (const [key, n] of counts) {
      if (!key.startsWith('id:')) {
        ipFallback += 1;
        continue;
      }
      installs += 1;
      if (n <= 2) buckets['1-2'] += 1;
      else if (n <= 5) buckets['3-5'] += 1;
      else if (n <= 10) buckets['6-10'] += 1;
      else if (n <= 30) buckets['11-30'] += 1;
      else buckets['31+'] += 1;
    }
    return {
      per_day: perDay,
      installs_active: installs,
      ip_fallback_active: ipFallback,
      quota_hits: quotaHits,
      usage: buckets,
    };
  }

  return { middleware, snapshot };
}
