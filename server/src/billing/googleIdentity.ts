import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Verifies the Google ID token the app hands over after a sign-in.
 *
 * WHY THIS EXISTS: a licence key is a bearer string — whoever holds it is the
 * subscriber, so it can be forwarded to a crowd. Binding the subscription to a
 * Google account instead makes "give away your subscription" mean "give away
 * your Google account", which people do not do. The app never sends us a
 * password; it sends a token Google signed, and this module is the part that
 * decides whether to believe it.
 *
 * WHAT AN ID TOKEN IS: a JWT signed by Google with a key from a published, and
 * ROTATING, key set. The only claim we keep is `sub` — a stable, opaque id for
 * the account. Not the email, not the name: we do not need them, and what is
 * never stored cannot leak or need a policy entry.
 *
 * FOUR CHECKS, AND EVERY ONE OF THEM IS LATER SOMEONE'S CVE IF SKIPPED:
 *
 *  1. The algorithm is PINNED to RS256 rather than read from the token. A JWT
 *     header is attacker-controlled: `alg: none` asks us to skip verification
 *     entirely, and `alg: HS256` asks us to verify an HMAC using Google's PUBLIC
 *     key as the shared secret — a key the attacker also has. Trusting that
 *     field is the classic JWT forgery.
 *  2. `aud` must be OUR client id. Google signs tokens for every app on earth
 *     with the same keys, so a valid signature alone proves nothing: without
 *     this check, a token minted for any other application logs its bearer into
 *     Driftora.
 *  3. `iss` must be Google.
 *  4. `exp` must be in the future — an old token, once captured, would otherwise
 *     work forever.
 *
 * "COULD NOT REACH GOOGLE" IS NOT "FORGED". This module throws for the former
 * and returns null for the latter, the same split entitlements.ts already draws
 * for stores: conflating them would sign people out during a Google outage and
 * tell them their account is fake.
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/** Fallback when Google's cache header is missing or unparseable. */
const DEFAULT_JWKS_TTL_MS = 3600_000;
/** Do not re-fetch more often than this, even on a miss — a bad token must not become a DoS lever. */
const MIN_REFETCH_INTERVAL_MS = 60_000;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface GoogleIdentity {
  /** Stable, opaque account id. The only thing we keep. */
  sub: string;
}

export interface GoogleVerifierOptions {
  /**
   * Client ids a token may be addressed to. The Web client id is the one Google
   * puts in `aud` even for an Android sign-in, which is why the app is
   * configured with `webClientId` — a common and confusing gotcha.
   */
  clientIds: string[];
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity | null>;

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(b64urlToBuffer(part).toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `max-age` from a Cache-Control header, in ms. */
function ttlFromCacheControl(header: string | null): number {
  const match = /max-age=(\d+)/i.exec(header ?? '');
  const seconds = match ? Number(match[1]) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_JWKS_TTL_MS;
}

export function createGoogleVerifier(opts: GoogleVerifierOptions): GoogleVerifier {
  const now = opts.now ?? Date.now;
  const doFetch = opts.fetchImpl ?? fetch;
  const audiences = new Set(opts.clientIds.filter(Boolean));

  let keys = new Map<string, Jwk>();
  let expiresAt = 0;
  let lastFetchAt = 0;
  let inFlight: Promise<void> | null = null;

  async function fetchKeys(): Promise<void> {
    // Collapse concurrent refreshes: a burst of launches must not become a burst
    // of identical requests to Google.
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const res = await doFetch(JWKS_URL);
      if (!res.ok) throw new Error(`google jwks fetch failed: ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      const next = new Map<string, Jwk>();
      for (const key of body.keys ?? []) {
        if (key.kid && key.kty === 'RSA') next.set(key.kid, key);
      }
      if (next.size === 0) throw new Error('google jwks contained no RSA keys');
      keys = next;
      lastFetchAt = now();
      expiresAt = lastFetchAt + ttlFromCacheControl(res.headers.get('cache-control'));
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function keyFor(kid: string): Promise<Jwk | null> {
    if (now() >= expiresAt) await fetchKeys();
    const hit = keys.get(kid);
    if (hit) return hit;
    // Unknown kid usually means Google rotated early. Refetch once, but not more
    // often than the floor — otherwise a stream of tokens with invented kids
    // turns us into a load generator against Google.
    if (now() - lastFetchAt >= MIN_REFETCH_INTERVAL_MS) {
      await fetchKeys();
      return keys.get(kid) ?? null;
    }
    return null;
  }

  return async function verify(idToken: string): Promise<GoogleIdentity | null> {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const [headerPart = '', payloadPart = '', signaturePart = ''] = parts;

    const header = decodeJson(headerPart);
    // PINNED, not read from the token — see the note above on `alg`.
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

    const jwk = await keyFor(header.kid);
    if (!jwk) return null;

    let ok: boolean;
    try {
      const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
      ok = createVerify('RSA-SHA256')
        .update(`${headerPart}.${payloadPart}`)
        .verify(publicKey, b64urlToBuffer(signaturePart));
    } catch {
      // A malformed key or signature is a bad token, not an outage.
      return null;
    }
    if (!ok) return null;

    const payload = decodeJson(payloadPart);
    if (!payload) return null;

    const iss = typeof payload.iss === 'string' ? payload.iss : '';
    if (!ISSUERS.has(iss)) return null;

    const aud = typeof payload.aud === 'string' ? payload.aud : '';
    if (!audiences.has(aud)) return null;

    const exp = typeof payload.exp === 'number' ? payload.exp : 0;
    if (exp * 1000 <= now()) return null;

    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub) return null;

    return { sub };
  };
}

/** Build from env, or null when this deployment has no Google identity configured. */
export function resolveGoogleVerifier(): GoogleVerifier | null {
  const ids = (process.env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return null;
  return createGoogleVerifier({ clientIds: ids });
}
