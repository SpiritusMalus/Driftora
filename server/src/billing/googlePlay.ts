import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PurchaseVerification, PurchaseVerifier } from '../entitlements.js';

/**
 * Google Play adapter: turns a client-supplied purchase token into a verdict
 * from Google, which is the only party that actually knows whether money moved.
 *
 * Everything the client says about its own purchase is a claim, including the
 * product id — a token for the cheap SKU must not unlock the expensive tier just
 * because the app asked nicely. So the productId Google reports is what gets
 * stored; the caller's is only a hint for logging.
 *
 * Auth is a service-account JWT exchanged for an access token (the
 * androidpublisher scope). No SDK: signing an RS256 assertion is ~15 lines of
 * node:crypto, and the alternative pulls googleapis — a very large dependency —
 * into a service whose entire runtime is express + multer.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

/** Refresh a bit before Google's hour is up, so no request rides an expiring token. */
const TOKEN_SKEW_MS = 5 * 60 * 1000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** Google's `subscriptionState` → our vocabulary. */
function mapState(state: string, expiresAt: number, now: number): PurchaseVerification['state'] {
  switch (state) {
    case 'SUBSCRIPTION_STATE_ACTIVE':
      return 'active';
    case 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD':
      // Payment failed but Google is retrying and the user still has access.
      return 'grace';
    case 'SUBSCRIPTION_STATE_ON_HOLD':
    case 'SUBSCRIPTION_STATE_PAUSED':
      return 'paused';
    case 'SUBSCRIPTION_STATE_CANCELED':
      // Cancelled ≠ over: they turned off renewal, and the period they paid for
      // is still theirs. Cutting access here is the single most common way to
      // turn a lapsing subscriber into an angry review.
      return expiresAt > now ? 'active' : 'expired';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'expired';
    default:
      // PENDING / PENDING_PURCHASE_CANCELED and anything Google adds later: no
      // money has settled, so no paid tier.
      return 'expired';
  }
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function loadServiceAccount(source: string): ServiceAccount {
  // Inline JSON (a container secret) or a path on disk (systemd deployment).
  const raw = source.trim().startsWith('{') ? source : readFileSync(source, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('service account JSON is missing client_email/private_key');
  }
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

export interface GooglePlayOptions {
  /** Inline service-account JSON or a path to it. Default: env. */
  serviceAccount?: string;
  packageName?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Builds the verifier. Throws at construction when misconfigured — a server that
 * silently cannot verify purchases would quietly sell nothing while looking
 * healthy, which is the failure mode worth crashing at boot to avoid.
 */
export function createGooglePlayVerifier(opts: GooglePlayOptions = {}): PurchaseVerifier {
  const source = opts.serviceAccount ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '';
  const packageName = opts.packageName ?? process.env.ANDROID_PACKAGE_NAME ?? 'com.driftora.app';
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  if (!source) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const account = loadServiceAccount(source);

  let cachedToken = '';
  let cachedUntil = 0;

  async function accessToken(): Promise<string> {
    const ms = now();
    if (cachedToken && ms < cachedUntil) return cachedToken;

    const iat = Math.floor(ms / 1000);
    const claims = {
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + 3600,
    };
    const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(account.private_key);
    const assertion = `${signingInput}.${b64url(signature)}`;

    const res = await doFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('google token exchange returned no access_token');

    cachedToken = body.access_token;
    cachedUntil = ms + Math.max(0, (body.expires_in ?? 3600) * 1000 - TOKEN_SKEW_MS);
    return cachedToken;
  }

  return async function verify(purchaseToken: string, productId: string): Promise<PurchaseVerification | null> {
    const token = await accessToken();
    const url = `${API_BASE}/${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${token}` } });

    if (res.status === 404) {
      // Google does not know this token: forged, or from another package. The
      // ONLY status that earns a definite "no" — everything else falls through
      // to the throw below, which the caller surfaces as "retry later".
      //
      // 400 deliberately does NOT land here. It usually means WE sent something
      // malformed, and mapping our own bug onto "the store does not recognize
      // this purchase" would accuse a paying customer of fraud.
      return null;
    }
    if (!res.ok) throw new Error(`google purchase lookup failed: ${res.status}`);

    const body = (await res.json()) as {
      subscriptionState?: string;
      lineItems?: Array<{ productId?: string; expiryTime?: string }>;
    };

    const lineItems = body.lineItems ?? [];
    // A subscription can carry several line items; the entitlement lasts as long
    // as the furthest one.
    let expiresAt = 0;
    for (const item of lineItems) {
      const t = item.expiryTime ? Date.parse(item.expiryTime) : Number.NaN;
      if (Number.isFinite(t) && t > expiresAt) expiresAt = t;
    }

    // Google's product id, not the client's claim (see the file header).
    const resolvedProduct = lineItems.find((i) => i.productId)?.productId ?? productId;

    return {
      productId: resolvedProduct,
      expiresAt,
      state: mapState(body.subscriptionState ?? '', expiresAt, now()),
    };
  };
}
