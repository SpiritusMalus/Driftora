import type { Request, Response } from 'express';
import { ipKeyGenerator, rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

// Per-IP throttling for the Gemini-backed parse endpoints — an abuse / cost
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
  };
}

/** Per-IP key, IPv6 grouped to a /64 subnet via the package's own helper. */
function perIpKey(req: Request): string {
  return ipKeyGenerator(req.ip ?? '', IPV6_SUBNET);
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
    keyGenerator: perIpKey,
    skip,
    // Reuse the app's error envelope; the middleware has already set the
    // RateLimit-*/Retry-After headers, and we leave those in place.
    handler: (_req, res) => fail(res as Response, 429, 'rate_limited', 'Too many requests.'),
  });
}

export interface Limiters {
  /** Global burst guard — mount early (after `trust proxy`); skips `/health`. */
  burst: RateLimitRequestHandler;
  /** Daily cap — mount on POST /food/parse before the Gemini call. */
  textDaily: RateLimitRequestHandler;
  /** Daily cap — mount on POST /food/parse-photo before multer buffers the upload. */
  photoDaily: RateLimitRequestHandler;
}

export function buildLimiters(limits: RateLimits, fail: FailFn): Limiters {
  return {
    burst: limiter(MINUTE_MS, limits.burstPerMin, fail, (req) => req.path === '/health'),
    textDaily: limiter(DAY_MS, limits.textPerDay, fail),
    photoDaily: limiter(DAY_MS, limits.photoPerDay, fail),
  };
}
