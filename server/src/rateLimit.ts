import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

import { installIdOf } from './installQuota.js';

// Per-IP throttling for the LLM-backed parse endpoints — an abuse / cost
// guard, NOT per-user identity (the static APP_TOKEN is shared, so it can't key
// limits). In-memory store is correct: a single Node instance behind Caddy. If
// the service is ever horizontally scaled, swap to a shared store (Redis).

/** Per-IP request caps (positive integers; requests per window). */
export interface RateLimits {
  /** Global burst guard across all routes: max requests per IP per minute. */
  burstPerMin: number;
  /** Daily cap per IP on POST /food/parse (text). */
  textPerDay: number;
  /** Daily cap per IP on POST /food/parse-photo (vision — pricier, so tighter). */
  photoPerDay: number;
  /**
   * Daily cap per IP on POST /billing/register. Its own bucket on purpose: the
   * route fans out to the store's API on every call, so it needs a ceiling — but
   * sharing the parse budget would let launch-time purchase checks eat into
   * someone's meals behind the same CGNAT address.
   */
  billingPerDay: number;
  /**
   * ЁМКОСТЬ СЕРВИСА, названная своим именем: max requests per minute across
   * EVERY caller. Personal limits below are keyed per client, so nothing else
   * bounds the box as a whole — and a global ceiling that exists by accident
   * (a per-IP limit behind a proxy that hands every request the same address)
   * is worse than one that exists on purpose: it can't be sized, and it reads
   * in the logs as if one user were flooding.
   */
  globalPerMin: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// Key IPv6 clients by /64 so a single client can't rotate within its subnet to
// dodge the cap (the package default is /56; /64 per the task spec).
const IPV6_SUBNET = 64;

/** Read a positive-integer env override, else the fallback. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Resolve effective limits: explicit `overrides` (tests use tiny, deterministic
 * caps) win over `RL_*` env vars, which win over the defaults. Defaults are
 * deliberately generous — per-IP is coarse for mobile (CGNAT means many users
 * can share one IP), so this caps abuse, not normal use. Precise per-device
 * limiting is a separate, larger task (needs a device-id / per-install token).
 */
export function resolveLimits(overrides: Partial<RateLimits> = {}): RateLimits {
  return {
    burstPerMin: overrides.burstPerMin ?? envInt('RL_BURST_PER_MIN', 30),
    textPerDay: overrides.textPerDay ?? envInt('RL_TEXT_PER_DAY', 300),
    photoPerDay: overrides.photoPerDay ?? envInt('RL_PHOTO_PER_DAY', 100),
    // A legitimate client registers once per launch, so this is roomy for a
    // shared exit IP while still bounding a token-guessing flood.
    billingPerDay: overrides.billingPerDay ?? envInt('RL_BILLING_PER_DAY', 120),
    // Roomy by design: it is the box's own guard rail, not a personal budget —
    // it must stay far above what any one honest client does in a minute.
    globalPerMin: overrides.globalPerMin ?? envInt('RL_GLOBAL_PER_MIN', 300),
  };
}

/**
 * КЛЮЧ ЛИМИТА — САМЫЙ ТОЧНЫЙ ИЗ ДОСТОВЕРНЫХ, А НЕ ВСЕГДА АДРЕС.
 *
 * Адрес клиента доезжает сюда не всегда: перед сервисом стоит SNI-роутер,
 * который отдаёт Caddy соединение уже от себя, и бэкенд видит `127.0.0.1` для
 * ВСЕХ. Ключ по адресу тогда схлопывает всех пользователей в одну корзину —
 * «30 запросов в минуту» превращается в 30 на весь сервис, и первый же
 * активный человек (или прогон эвала) выедает лимит у остальных. Причём молча:
 * ни в метриках, ни в логах это не видно, потому что формально лимит работает.
 *
 * Поэтому ключуем по установке, когда она себя назвала (`X-Install-Id` — тот же
 * идентификатор, которым уже меряется ИИ-квота), и падаем на адрес, когда нет.
 * Подделать заголовок можно — ровно как и сегодня для квоты, — но это НЕ хуже
 * общей корзины: там любой прохожий и так тратил чужой лимит.
 */
function clientKey(req: Request): string {
  const install = installIdOf(req);
  if (install) return `i:${install}`;
  return `ip:${ipKeyGenerator(req.ip ?? '', IPV6_SUBNET)}`;
}

type FailFn = (res: Response, status: number, code: string, message: string) => void;

function limiter(
  windowMs: number,
  limit: number,
  fail: FailFn,
  skip?: (req: Request) => boolean,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit-* + Retry-After
    legacyHeaders: false,
    keyGenerator: clientKey,
    skip,
    // Reuse the app's error envelope; the middleware has already set the
    // RateLimit-*/Retry-After headers, and we leave those in place.
    handler: (_req, res) => fail(res as Response, 429, 'rate_limited', 'Too many requests.'),
  });
}

export interface Limiters {
  /** Per-client burst guard — mount early (after `trust proxy`); skips `/health`. */
  burst: RateLimitRequestHandler;
  /** The box's own ceiling across ALL callers — mount right before `burst`. */
  global: RateLimitRequestHandler;
  /** Daily cap — mount on POST /food/parse before the LLM call. */
  textDaily: RateLimitRequestHandler;
  /** Daily cap — mount on POST /food/parse-photo before multer buffers the upload. */
  photoDaily: RateLimitRequestHandler;
  /** Daily cap — mount on POST /billing/register before the store round-trip. */
  billingDaily: RateLimitRequestHandler;
}

export function buildLimiters(limits: RateLimits, fail: FailFn): Limiters {
  return {
    // The payment webhook is exempt alongside /health: it is already gated by a
    // source-IP allowlist, ЮKassa's few addresses would share one bucket, and
    // 429-ing your payment provider only converts settled money into a 24-hour
    // redelivery storm.
    burst: limiter(
      MINUTE_MS,
      limits.burstPerMin,
      fail,
      (req) => req.path === '/health' || req.path === '/billing/yookassa/webhook',
    ),
    // Same exemptions as the burst guard, and the same handler: what differs is
    // only the key — this one is deliberately shared by everybody.
    global: rateLimit({
      windowMs: MINUTE_MS,
      limit: limits.globalPerMin,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: () => 'all',
      skip: (req) => req.path === '/health' || req.path === '/billing/yookassa/webhook',
      handler: (_req, res) => fail(res as Response, 429, 'rate_limited', 'Too many requests.'),
    }),
    textDaily: limiter(DAY_MS, limits.textPerDay, fail),
    photoDaily: limiter(DAY_MS, limits.photoPerDay, fail),
    billingDaily: limiter(DAY_MS, limits.billingPerDay, fail),
  };
}
