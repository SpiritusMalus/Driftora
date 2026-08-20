import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

/**
 * Per-INSTALL AI budget for the LLM-backed parse endpoints — the fine-grained
 * layer the per-IP caps can't provide. Mobile CGNAT puts hundreds of honest
 * users behind one operator IP, so per-IP daily caps (rateLimit.ts) start
 * 429-ing real people as soon as a handful of them share an exit address;
 * rateLimit.ts:35 anticipated exactly this («precise per-device limiting is a
 * separate, larger task»). This is that task's first half: the client sends a
 * random `X-Install-Id` header (no account, no device identifier — a coin flip
 * stored in app_settings), and each install gets its own AI budget.
 *
 * TWO BUDGETS, TWO DIFFERENT SHAPES (owner's call, 2026-08-20):
 *
 *   free — {@link DEFAULT_FREE_TOTAL} parses TOTAL for the life of the install.
 *          A trial, not an allowance: it never refills. Spending it is the
 *          paywall, and the only remedy is a subscription.
 *   paid — {@link DEFAULT_PER_DAY_PAID} parses per UTC day. Not "unlimited": an
 *          unbounded plan is an unbounded bill, and the escalation SLI
 *          (operations.md §6) is what turns ~$0.3–0.5/month per active user into
 *          something else. A fair-use ceiling nobody eating food will reach.
 *
 * THE FREE COUNTER IS THEREFORE PERSISTENT, and it has to be: a lifetime cap
 * held only in memory is not a cap at all — every deploy would hand everyone a
 * fresh trial, and the number in the UI would be a lie by the end of the week.
 * Same append-only JSONL + atomic-rewrite shape as entitlements.ts, for the same
 * reason (prod is Node 20, no `node:sqlite`, and this stays dependency-free).
 * The paid day counter stays in memory on purpose — there, a restart forgiving
 * today's spend really is acceptable slack.
 *
 * HONEST THREAT MODEL: the id is client-generated and therefore spoofable — an
 * abuser can rotate ids, and a plain reinstall mints a new one. So this layer
 * METERS honest apps and shapes the free/paid tiers; the coarser per-IP caps
 * stay mounted as the abuse backstop. Neither layer replaces the other, and a
 * lifetime free tier does not pretend to be theft-proof.
 *
 * The counters also feed `/metrics` with an anonymous usage histogram plus the
 * one number the funnel needs: how many installs have spent the trial.
 */

/** Free-tier AI parses per install, for the life of the install. NOT per day. */
const DEFAULT_FREE_TOTAL = 30;

/**
 * Paid-tier cap, per install per UTC day.
 *
 * BOTH CAPS ARE ENV-TUNABLE ON PURPOSE (`AI_FREE_TOTAL`,
 * `AI_PER_INSTALL_PER_DAY_PAID`): the usage histogram is still thin, so the
 * numbers may well be wrong and must be fixable by a restart rather than a store
 * release. Raising them is free; lowering the paid one on people who already
 * bought it is not — so start generous.
 */
const DEFAULT_PER_DAY_PAID = 30;

/** Same /64 grouping as rateLimit.ts, for clients that don't send an id yet. */
const IPV6_SUBNET = 64;

/** Client-generated ids: hex/uuid-ish, bounded so the key store can't be ballooned. */
const INSTALL_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Hard bound on tracked keys — far above any real install count. */
const MAX_KEYS = 50_000;

/** Compaction trigger: rewrite once the log is mostly superseded lines. */
const COMPACT_RATIO = 4;

/** Config warnings are a property of the PROCESS, not of each app instance a test spins up. */
let warnedOnce = false;

type FailFn = (res: Response, status: number, code: string, message: string) => void;

/** Which budget answered for this caller — the two mean opposite things to a client. */
export type QuotaScope = 'total' | 'day';

/**
 * The caller's install id when it is present and well-formed, else null.
 *
 * Exported so everything that scopes state to "one install" agrees on what an
 * install IS — the quota key below, and the photo route's label cache, which
 * must never let one install's panel reading answer another's photo.
 */
export function installIdOf(req: Request): string | null {
  const raw = req.get('x-install-id') || '';
  return INSTALL_ID_RE.test(raw) ? raw : null;
}

export interface InstallQuotaOptions {
  /** Override the free lifetime cap (tests use tiny values). 0 disables the quota. */
  freeTotal?: number;
  /** Override the paid per-day cap. */
  perDayPaid?: number;
  /**
   * Whether this caller has an active purchase. Defaults to "nobody is paying",
   * which is the honest default for a build with no billing wired up: the free
   * tier is what everyone gets until an entitlement says otherwise.
   */
  isPaid?: (req: Request) => boolean;
  /** JSONL path for the lifetime free counters. Empty keeps them in memory (tests). */
  path?: string;
  /** Injectable clock for deterministic day-rollover tests. */
  now?: () => number;
}

/** What a caller has left, without spending anything — what the paywall screen reads. */
export interface QuotaState {
  scope: QuotaScope;
  cap: number;
  used: number;
  remaining: number;
  /** Both caps, so a client can state the offer without hardcoding either number. */
  freeTotal: number;
  perDayPaid: number;
}

export interface InstallQuota {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /**
   * Consume one unit WITHOUT failing the response — for routes where the LLM
   * call is an optional extra beside a non-AI result (/food/search's AI card).
   * False when the cap is spent; the caller degrades gracefully (DB rows still
   * served) instead of 429ing the whole request.
   */
  tryConsume: (req: Request, res: Response) => boolean;
  /** Read-only view for /billing/status. Null when the layer is disabled. */
  stateOf: (req: Request) => QuotaState | null;
  /** Aggregate-only snapshot for /metrics — never contains an id. */
  snapshot: () => Record<string, unknown>;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** UTC day stamp — the paid quota's window. */
function dayOf(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

/** Seconds until the next UTC midnight, for an honest Retry-After. */
function secondsToReset(ms: number): number {
  return Math.max(1, Math.ceil(((dayOf(ms) + 1) * 86_400_000 - ms) / 1000));
}

/** One persisted line: how much of the free trial this install has spent. */
interface SpendRecord {
  id: string;
  used: number;
  at: number;
}

export function createInstallQuota(fail: FailFn, opts: InstallQuotaOptions = {}): InstallQuota {
  const freeTotal = opts.freeTotal ?? envInt('AI_FREE_TOTAL', DEFAULT_FREE_TOTAL);
  const perDayPaid = opts.perDayPaid ?? envInt('AI_PER_INSTALL_PER_DAY_PAID', DEFAULT_PER_DAY_PAID);
  const isPaid = opts.isPaid ?? (() => false);
  const now = opts.now ?? Date.now;
  const path = opts.path ?? process.env.AI_QUOTA_PATH ?? '';

  // Free trial spend per install — LIFETIME, persisted, never cleared by a day.
  const spent = new Map<string, number>();
  // Paid (and id-less) spend today. Cleared on rollover, memory only.
  const dayCounts = new Map<string, number>();
  // Who used AI today, whichever budget paid for it — the /metrics histogram
  // only. Kept apart from `dayCounts` so metering a free user against a lifetime
  // budget doesn't erase them from the "active today" picture.
  const activeToday = new Map<string, number>();

  let currentDay = dayOf(now());
  let appended = 0;
  let quotaHits = 0;
  let quotaHitsPaid = 0;

  function load(): void {
    if (!path || !existsSync(path)) return;
    let lines: string[];
    try {
      lines = readFileSync(path, 'utf8').split('\n');
    } catch (err) {
      // An unreadable file must not take the parse service down with it. Starting
      // empty is the generous failure (everyone's trial looks untouched), which
      // beats refusing to boot — but it is a real loss, so it is loud.
      console.error('ai quota: load failed:', err instanceof Error ? err.message : String(err));
      return;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as SpendRecord;
        // Last line wins: the log is a sequence of upserts, not a set.
        if (typeof rec?.id === 'string' && Number.isFinite(rec.used)) {
          spent.set(rec.id, Math.max(0, Math.floor(rec.used)));
          appended += 1;
        }
      } catch {
        // One corrupt line (a torn write on power loss) must not discard the
        // rest of the log — skip it and keep reading.
      }
    }
  }

  function persist(id: string, used: number): void {
    if (!path) return;
    const rec: SpendRecord = { id, used, at: now() };
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(rec)}\n`);
      appended += 1;
    } catch (err) {
      // In-memory state is already updated, so the cap holds until the next
      // restart. Loud, because a silently unpersisted lifetime cap is exactly the
      // failure this file exists to prevent.
      console.error('ai quota: persist failed:', err instanceof Error ? err.message : String(err));
      return;
    }
    // Separate try: a failed compaction leaves a correct (merely longer) log, and
    // reporting it as "persist failed" would send someone hunting for lost spend
    // that was in fact written.
    if (appended > spent.size * COMPACT_RATIO && appended > 64) {
      try {
        compact();
      } catch (err) {
        console.error('ai quota: compaction failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /** Rewrite the log as one line per install, atomically (tmp + rename). */
  function compact(): void {
    const tmp = `${path}.tmp`;
    const at = now();
    const body = [...spent.entries()].map(([id, used]) => JSON.stringify({ id, used, at } satisfies SpendRecord)).join('\n');
    writeFileSync(tmp, body ? `${body}\n` : '');
    renameSync(tmp, path);
    appended = spent.size;
  }

  /** Drop yesterday's day-scoped state. The lifetime map is deliberately untouched. */
  function rollDay(ms: number): void {
    const day = dayOf(ms);
    if (day === currentDay) return;
    currentDay = day;
    dayCounts.clear();
    activeToday.clear();
  }

  /** Fallback key for clients that don't send an id yet. */
  function ipKeyOf(req: Request): string {
    return `ip:${ipKeyGenerator(req.ip ?? '', IPV6_SUBNET)}`;
  }

  /**
   * Bound a map's growth, oldest-first (insertion order doubles as the queue).
   *
   * For the lifetime map this hands the evicted install a fresh trial, and the
   * next line it writes makes that permanent. Deliberate slack at MAX_KEYS: the
   * bound sits far above any install count this service will see, and losing a
   * cap on the oldest of fifty thousand beats refusing to serve the newest.
   */
  function evictIfFull(map: Map<string, number>, key: string): void {
    if (map.has(key) || map.size < MAX_KEYS) return;
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }

  /**
   * Which budget applies to this caller, and where it stands.
   *
   * A purchase switches the LANE, it does not refund the trial: the free counter
   * keeps whatever it holds, so a subscription that later lapses drops the user
   * back onto a spent trial rather than a fresh one. The flip side, deliberate:
   * on the day someone buys, they get the full paid day even if they had just
   * exhausted the free total — the purchase has to work immediately, or it reads
   * as broken.
   *
   * Clients with no (valid) install id — older builds — get the free number as a
   * DAILY budget keyed by IP instead. A lifetime cap on an IP would be a
   * catastrophe under CGNAT: one operator's exit address would be banned forever
   * once thirty strangers behind it had eaten breakfast.
   */
  interface Lane {
    scope: QuotaScope;
    cap: number;
    store: Map<string, number>;
    key: string;
    paid: boolean;
  }

  function laneOf(req: Request): Lane {
    const id = installIdOf(req);
    const paid = isPaid(req);
    if (paid) {
      return { scope: 'day', cap: perDayPaid, store: dayCounts, key: id ? `id:${id}` : ipKeyOf(req), paid };
    }
    if (id) return { scope: 'total', cap: freeTotal, store: spent, key: id, paid };
    return { scope: 'day', cap: freeTotal, store: dayCounts, key: ipKeyOf(req), paid };
  }

  function stateOf(req: Request): QuotaState | null {
    // No id ⇒ nobody to describe. The ip lane below exists to METER clients that
    // don't send one; putting an exit address's shared budget on someone's
    // subscription screen as «сколько у вас осталось» would be a number that
    // belongs to strangers behind the same CGNAT. Saying nothing is correct, and
    // the client already has a numberless sentence for it.
    if (!installIdOf(req)) return null;
    rollDay(now());
    const lane = laneOf(req);
    if (lane.cap <= 0) return null; // explicitly disabled
    const used = lane.store.get(lane.key) ?? 0;
    return {
      scope: lane.scope,
      cap: lane.cap,
      used,
      remaining: Math.max(0, lane.cap - used),
      freeTotal,
      perDayPaid,
    };
  }

  /** One consume attempt; the scope comes back out so the 429 can speak plainly. */
  function consume(req: Request, res: Response): { ok: boolean; scope: QuotaScope } {
    const ms = now();
    rollDay(ms);

    const lane = laneOf(req);
    if (lane.cap <= 0) return { ok: true, scope: lane.scope }; // explicitly disabled

    // The scope rides on every answer, success or 429: «осталось 3» means
    // something entirely different when it never comes back tomorrow, and a
    // client that cannot tell the two apart has to guess in the one sentence the
    // user actually reads.
    res.setHeader('X-AI-Quota-Scope', lane.scope);

    const used = lane.store.get(lane.key) ?? 0;
    if (used >= lane.cap) {
      quotaHits += 1;
      // Counted apart because the two mean opposite things: a free-tier hit is
      // the paywall doing its job, a paid-tier hit is a fair-use ceiling set too
      // low — a bug report from someone who already paid.
      if (lane.paid) quotaHitsPaid += 1;
      res.setHeader('X-AI-Quota-Remaining', '0');
      // Retry-After ONLY where waiting is actually the remedy. A spent lifetime
      // trial has no tomorrow, and telling a client to come back at midnight
      // would send it into a retry loop against a wall.
      if (lane.scope === 'day') res.setHeader('Retry-After', String(secondsToReset(ms)));
      return { ok: false, scope: lane.scope };
    }

    evictIfFull(lane.store, lane.key);
    lane.store.set(lane.key, used + 1);
    if (lane.scope === 'total') persist(lane.key, used + 1);

    const activeKey = lane.scope === 'total' ? `id:${lane.key}` : lane.key;
    evictIfFull(activeToday, activeKey);
    activeToday.set(activeKey, (activeToday.get(activeKey) ?? 0) + 1);

    // The client shows a quiet «осталось N» once this runs low — the honest
    // alternative to a surprise 429 at the day's fifth meal.
    res.setHeader('X-AI-Quota-Remaining', String(lane.cap - used - 1));
    return { ok: true, scope: lane.scope };
  }

  function tryConsume(req: Request, res: Response): boolean {
    return consume(req, res).ok;
  }

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const { ok, scope } = consume(req, res);
    if (!ok) {
      fail(
        res,
        429,
        'ai_quota_exceeded',
        scope === 'total'
          ? 'Free AI parse allowance for this install is spent.'
          : 'Daily AI parse quota reached for this install.',
      );
      return;
    }
    next();
  }

  function snapshot(): Record<string, unknown> {
    // Usage histogram over id-keyed installs only (ip-fallback keys are mixed
    // crowds behind CGNAT — counting them as "one install" would skew the very
    // distribution this exists to measure).
    const buckets = { '1-2': 0, '3-5': 0, '6-10': 0, '11-30': 0, '31+': 0 };
    let installs = 0;
    let ipFallback = 0;
    // The day rolls over in `tryConsume`, so on a day with no AI traffic yet
    // `activeToday` still holds YESTERDAY's keys. Reporting them as today's
    // actives made /metrics claim installs that had not been seen — the same
    // class of lie as the SLO check going green on no traffic. Read the day here
    // too.
    const today = dayOf(now()) === currentDay ? activeToday : new Map<string, number>();
    for (const [key, n] of today) {
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
    // The funnel number the daily histogram cannot show: how many installs have
    // reached the wall the subscription exists to remove.
    let exhausted = 0;
    if (freeTotal > 0) for (const used of spent.values()) if (used >= freeTotal) exhausted += 1;
    return {
      free_total: freeTotal,
      per_day_paid: perDayPaid,
      persisted: Boolean(path),
      installs_active: installs,
      ip_fallback_active: ipFallback,
      installs_known: spent.size,
      installs_exhausted: exhausted,
      quota_hits: quotaHits,
      quota_hits_paid: quotaHitsPaid,
      usage: buckets,
    };
  }

  load();

  if (!warnedOnce) {
    warnedOnce = true;
    warnAboutConfig(freeTotal, path);
  }

  return { middleware, tryConsume, stateOf, snapshot };
}

/** Config traps worth a line in journalctl, said once per process. */
function warnAboutConfig(freeTotal: number, path: string): void {
  if (freeTotal > 0 && !path) {
    // Not fatal (tests and eval runs want exactly this), but on a real
    // deployment it means the lifetime cap silently resets on every restart —
    // and the app is meanwhile telling people a number that isn't true.
    console.warn('ai quota: AI_QUOTA_PATH is unset — the free lifetime budget will reset on restart');
  }
  if (process.env.AI_PER_INSTALL_PER_DAY !== undefined) {
    // Renamed when the free tier stopped being a daily allowance. Silently
    // ignoring a knob someone set on purpose is how a cap ends up quietly wrong.
    console.warn('ai quota: AI_PER_INSTALL_PER_DAY is obsolete and ignored — the free tier is now AI_FREE_TOTAL (lifetime)');
  }
}
