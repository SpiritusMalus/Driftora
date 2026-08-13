import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { ensureSettings, updateSettings } from '../db/settings';
import { getCachedInstallId } from './installId';

/**
 * Client half of the AI subscription.
 *
 * WHAT IS ACTUALLY BOUGHT: a higher daily ceiling on AI food parses. Everything
 * local — diary, weight, mood, manual entry, the food database — is free and
 * stays free, because it costs us nothing to run.
 *
 * THE KEY IS THE SUBSCRIPTION. The user buys on the payment page, gets a licence
 * key, and types it in here; the server binds it to this install's `X-Install-Id`
 * and raises the cap. Losing the phone loses nothing — the same key re-activates
 * on the next one (up to five installs, oldest evicted).
 *
 * RE-REGISTERING ON EVERY LAUNCH IS NOT REDUNDANT. The server stores only a hash
 * of the key, so it cannot re-check a purchase on its own; the client resending
 * it is what turns a refund or an expiry into ended access rather than a stale
 * "paid" verdict. It is also what carries the subscription onto a new install id
 * after a reinstall or a backup restore.
 *
 * THE AI-CONSENT GATE HOLDS HERE TOO. `foodParserProvider.ts` documents that the
 * online parser is the app's only external call, gated on the cross-border AI
 * consent. These requests go to the same server and carry no diary content — but
 * they are still a network call, so every function below refuses to make one
 * without that consent. Nothing is lost by it: the subscription raises the cap
 * on AI parsing, which is exactly what a user without AI consent is not doing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/** Same window as a normal parse — these are small JSON round-trips. */
const TIMEOUT_MS = 15_000;

export type EntitlementState = 'active' | 'grace' | 'paused' | 'expired' | 'revoked' | 'none' | 'unknown';

export interface BillingStatus {
  /** False when the server sells nothing — the screen then explains, not sells. */
  billingEnabled: boolean;
  active: boolean;
  /** Epoch ms the paid period ends. 0 = the server did not say. */
  expiresAt: number;
  state: EntitlementState;
}

export type ActivationFailure =
  | 'invalid_key' // the server does not recognise it — a typo, or someone else's
  | 'not_selling' // this deployment has no shop configured
  | 'no_install_id' // nothing to bind the purchase to yet (first seconds of a launch)
  | 'unreachable'; // network, timeout, or the store could not be reached

export type ActivationResult = { ok: true; status: BillingStatus } | { ok: false; reason: ActivationFailure };

const OFFLINE: BillingStatus = { billingEnabled: false, active: false, expiresAt: 0, state: 'unknown' };

/**
 * Origin of the food server, derived from the configured parse endpoint
 * (`https://host/food/parse` → `https://host`). Empty when the app was built
 * without a server, which is also when every function below no-ops.
 */
export function billingOrigin(): string {
  const base = process.env.EXPO_PUBLIC_FOOD_API_URL ?? '';
  return /^(https?:\/\/[^/]+)/.exec(base)?.[1] ?? '';
}

/** Typed by hand off a screen — accept lowercase and stray spaces, like the server. */
export function normalizeLicenseKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function headers(): Record<string, string> {
  const out: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.EXPO_PUBLIC_FOOD_API_TOKEN;
  if (token) out.Authorization = `Bearer ${token}`;
  const install = getCachedInstallId();
  if (install) out['X-Install-Id'] = install;
  return out;
}

async function request(path: string, init: RequestInit = {}): Promise<Response | null> {
  const origin = billingOrigin();
  if (!origin) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${origin}${path}`, { ...init, headers: headers(), signal: controller.signal });
  } catch {
    // Network, DNS, timeout — indistinguishable from here and treated the same:
    // "we don't know", never "you didn't pay".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Has the user granted the cross-border AI consent this whole path is gated on? */
async function hasAiConsent(db: AnyDb): Promise<boolean> {
  const settings = await ensureSettings(db);
  return settings.aiFoodParseConsent === true;
}

/** The key this install last activated, or null. */
export async function storedLicenseKey(db: AnyDb): Promise<string | null> {
  const settings = await ensureSettings(db);
  const key = settings.licenseKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function parseStatus(body: unknown): BillingStatus {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    billingEnabled: b.billing_enabled === true,
    active: b.active === true,
    expiresAt: typeof b.expires_at === 'number' ? b.expires_at : 0,
    state: typeof b.state === 'string' ? (b.state as EntitlementState) : 'unknown',
  };
}

/** What the server currently thinks of this install. Never throws. */
export async function fetchBillingStatus(db: AnyDb): Promise<BillingStatus> {
  if (!(await hasAiConsent(db))) return OFFLINE;
  const res = await request('/billing/status');
  if (!res || !res.ok) return OFFLINE;
  try {
    return parseStatus(await res.json());
  } catch {
    return OFFLINE;
  }
}

/**
 * Register a licence key against this install, storing it only once the server
 * has confirmed it.
 *
 * Storing on success ONLY is the point: a key kept after a rejection would be
 * resent on every launch forever, and would make «у меня есть подписка» a
 * permanent, wrong claim in the UI.
 */
export async function activateLicense(db: AnyDb, rawKey: string): Promise<ActivationResult> {
  if (!(await hasAiConsent(db))) return { ok: false, reason: 'not_selling' };
  const key = normalizeLicenseKey(rawKey);
  if (!key) return { ok: false, reason: 'invalid_key' };
  if (!getCachedInstallId()) return { ok: false, reason: 'no_install_id' };

  const res = await request('/billing/register', {
    method: 'POST',
    // `productId` is what a store adapter would match on; for a licence key the
    // server ignores it, but the field is required by the shared route.
    body: JSON.stringify({ purchaseToken: key, productId: 'ai_subscription' }),
  });
  if (!res) return { ok: false, reason: 'unreachable' };
  if (res.status === 402) return { ok: false, reason: 'invalid_key' };
  if (res.status === 503) {
    // Both "this deployment sells nothing" and "the store was unreachable" come
    // back as 503; only the code separates them, and only one is the user's
    // problem to wait out.
    let code = '';
    try {
      code = (((await res.json()) as { error?: { code?: string } }).error?.code ?? '') as string;
    } catch {
      code = '';
    }
    return { ok: false, reason: code === 'billing_unavailable' ? 'not_selling' : 'unreachable' };
  }
  if (!res.ok) return { ok: false, reason: 'unreachable' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const parsed = parseStatus(body);
  // /billing/register answers without `billing_enabled` — reaching a 200 here IS
  // the proof that this deployment sells.
  const status: BillingStatus = { ...parsed, billingEnabled: true };
  await updateSettings(db, { licenseKey: key });
  return { ok: true, status };
}

/**
 * Launch-time refresh: re-register the stored key so the server's cached verdict
 * is renewed (and a refund or expiry actually ends access).
 *
 * Deliberately silent and best-effort. A failure here must never surface as an
 * error or clear the key — the server keeps what it cached, so a subscriber on a
 * plane stays a subscriber.
 */
export async function refreshEntitlement(db: AnyDb): Promise<void> {
  const key = await storedLicenseKey(db);
  if (!key) return;
  if (!(await hasAiConsent(db))) return;
  await activateLicense(db, key);
}

/** «Отвязать» — forget the key on this device. The subscription itself lives on. */
export async function forgetLicense(db: AnyDb): Promise<void> {
  await updateSettings(db, { licenseKey: null });
}

/* ------------------------------------------------------------------------- *
 * Buying from inside the app.
 *
 * The card form itself is ЮKassa's hosted page and cannot be anything else —
 * card data must never touch this app, and 3-D Secure is a redirect by design.
 * Everything AROUND it is native: the plan is picked here, the payment is
 * created here, the hosted form is shown in an in-app WebView, and the licence
 * key is collected and activated here. The buyer never sees a browser, never
 * copies a key, and never leaves the app.
 * ------------------------------------------------------------------------- */

export interface Plan {
  id: string;
  days: number;
  /** Roubles as a decimal string, e.g. "199.00" — the server owns the price. */
  amount: string;
  description: string;
}

export interface PlanList {
  /** False when the deployment sells nothing; the screen then explains why. */
  enabled: boolean;
  /** True → the shop issues fiscal receipts, so the buyer's email is required. */
  receiptRequired: boolean;
  plans: Plan[];
}

/** The price list, or null when unreachable. Never throws. */
export async function fetchPlans(db: AnyDb): Promise<PlanList | null> {
  if (!(await hasAiConsent(db))) return null;
  const res = await request('/billing/plans');
  if (!res || !res.ok) return null;
  try {
    const body = (await res.json()) as Record<string, unknown>;
    const raw = Array.isArray(body.plans) ? body.plans : [];
    return {
      enabled: body.enabled === true,
      receiptRequired: body.receipt_required === true,
      plans: raw
        .map((p) => p as Record<string, unknown>)
        .filter((p) => typeof p.id === 'string' && typeof p.amount === 'string')
        .map((p) => ({
          id: String(p.id),
          days: typeof p.days === 'number' ? p.days : 0,
          amount: String(p.amount),
          description: typeof p.description === 'string' ? p.description : '',
        })),
    };
  } catch {
    return null;
  }
}

export type CheckoutFailure = 'unreachable' | 'not_selling' | 'email_required' | 'unknown_plan';

export type CheckoutStart =
  | { ok: true; paymentId: string; confirmationUrl: string }
  | { ok: false; reason: CheckoutFailure };

/** Create the payment and get the hosted form's URL to show in the WebView. */
export async function startCheckout(
  db: AnyDb,
  input: { plan: string; email?: string; licenseKey?: string },
): Promise<CheckoutStart> {
  if (!(await hasAiConsent(db))) return { ok: false, reason: 'not_selling' };
  const res = await request('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({
      plan: input.plan,
      email: input.email ?? '',
      license_key: input.licenseKey ?? '',
    }),
  });
  if (!res) return { ok: false, reason: 'unreachable' };

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  if (!res.ok) {
    const code = ((body.error as { code?: string } | undefined)?.code ?? '') as string;
    if (code === 'email_required' || code === 'invalid_email') return { ok: false, reason: 'email_required' };
    if (code === 'unknown_plan') return { ok: false, reason: 'unknown_plan' };
    if (code === 'billing_unavailable') return { ok: false, reason: 'not_selling' };
    return { ok: false, reason: 'unreachable' };
  }
  const paymentId = typeof body.payment_id === 'string' ? body.payment_id : '';
  const confirmationUrl = typeof body.confirmation_url === 'string' ? body.confirmation_url : '';
  if (!paymentId || !confirmationUrl) return { ok: false, reason: 'unreachable' };
  return { ok: true, paymentId, confirmationUrl };
}

/** The page ЮKassa returns to — the WebView watches for this to close itself. */
export const RETURN_PATH = '/billing/done';

/**
 * Wait for the licence the payment bought.
 *
 * POLLS, because the browser finishing and the payment settling are two
 * different events: the notification that mints the licence is a separate
 * delivery from ЮKassa and normally lands within seconds. Giving up on the first
 * 404 would tell someone who just paid that they had not.
 *
 * Returns null if it never arrives — the caller then tells the buyer to open the
 * screen again in a minute, which is true and recoverable, rather than claiming
 * the payment failed.
 */
export async function claimLicenseKey(
  paymentId: string,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string | null> {
  const attempts = opts.attempts ?? 20;
  const delayMs = opts.delayMs ?? 3000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let i = 0; i < attempts; i += 1) {
    const res = await request(`/billing/license?payment_id=${encodeURIComponent(paymentId)}`);
    if (res?.ok) {
      try {
        const body = (await res.json()) as { key?: unknown };
        if (typeof body.key === 'string' && body.key.length > 0) return body.key;
      } catch {
        // Fall through to another attempt — a torn body is not an answer.
      }
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

/**
 * The whole tail of a purchase: collect the key, then activate it here.
 *
 * One function because these two steps must not drift apart — a key collected
 * and not activated is a subscription the buyer paid for and does not have.
 */
export async function finishCheckout(db: AnyDb, paymentId: string): Promise<ActivationResult> {
  const key = await claimLicenseKey(paymentId);
  if (!key) return { ok: false, reason: 'unreachable' };
  return activateLicense(db, key);
}
