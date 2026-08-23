import { randomBytes } from 'node:crypto';
import type { PurchaseVerifier } from '../entitlements.js';
import { createRecordLog, type RecordLog } from './recordLog.js';

/**
 * Licences sold DIRECTLY (ЮKassa), as opposed to through a store.
 *
 * The trick that keeps this small: a licence key is handed to `/billing/register`
 * in the same field as a Google purchase token, and this module exposes a
 * `PurchaseVerifier` like any store adapter. So direct sales cost the client
 * protocol and `entitlements.ts` exactly zero changes — the only difference is
 * which adapter recognises the string.
 *
 * WHY THE KEY IS STORED IN PLAINTEXT, unlike the Google token: that decision was
 * about REPLAY. A store token is a credential against Google, so a leaked file
 * had to be useless to an attacker. A licence key is our own invention with no
 * power anywhere else, and the buyer has to be able to read it back after paying.
 * The realistic loss from a leaked licence file is some free AI parsing — not
 * money, not anyone's data. Copying the hash-everything reflex here would have
 * bought nothing and made the purchase unreadable to the person who paid for it.
 */

/** No 0/O/1/I: this gets read off a screen and typed by hand. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUPS = 4;
const GROUP_LEN = 4;

const DAY_MS = 86_400_000;

/** How long each plan adds. `metadata.plan` on the payment picks one. */
export const PLAN_DAYS: Record<string, number> = {
  monthly: 30,
  yearly: 365,
};

export const DEFAULT_PLAN = 'monthly';

/**
 * Marks a licence handed out by `/billing/grant` rather than paid for.
 *
 * It sits in `paymentIds`, where ЮKassa's uuids live, and cannot collide with
 * one. That keeps comped access visible in both places it matters: the licence
 * file, and the `granted` counter in /metrics. Free access nobody can count is
 * how a support gesture quietly becomes the business model.
 */
export const MANUAL_PAYMENT_PREFIX = 'manual:';

export interface License {
  key: string;
  plan: string;
  /**
   * Google account that owns this licence, once the buyer linked one.
   *
   * Optional on purpose, and it is the difference between a subscription and a
   * bearer token: an unlinked licence is whatever its holder says it is, so a
   * key posted in a chat works for everyone who reads it. Linked, the key stops
   * being the subscription and becomes merely how the account first claimed it.
   */
  accountId?: string;
  /** Epoch ms the paid access ends. */
  paidUntil: number;
  /** Every payment that fed this licence — the idempotency guard and the audit trail. */
  paymentIds: string[];
  updatedAt: number;
}

export interface Licenses {
  /**
   * Apply a settled payment. Idempotent by `paymentId`: ЮKassa redelivers a
   * notification for 24 hours until it sees a 200, so the same payment WILL
   * arrive more than once, and each redelivery must not add another month.
   */
  applyPayment: (paymentId: string, plan: string, existingKey?: string) => License;
  byKey: (key: string) => License | undefined;
  byPaymentId: (paymentId: string) => License | undefined;
  byAccount: (accountId: string) => License | undefined;
  /**
   * Bind a licence to an account. Idempotent for the same account; refuses a
   * different one, because silently moving a paid licence to whoever signed in
   * last would let a shared key be stolen outright by its recipient.
   */
  attachAccount: (key: string, accountId: string) => License | null;
  verifier: PurchaseVerifier;
  snapshot: () => Record<string, unknown>;
}

export interface LicensesOptions {
  path?: string;
  now?: () => number;
  /** Injectable for deterministic key generation in tests. */
  generateKey?: () => string;
}

function randomKey(): string {
  const bytes = randomBytes(GROUPS * GROUP_LEN);
  let out = '';
  for (let i = 0; i < GROUPS * GROUP_LEN; i += 1) {
    if (i > 0 && i % GROUP_LEN === 0) out += '-';
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return out;
}

/** Typed by hand, so accept lowercase and stray spaces. */
export function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function isLicense(rec: unknown): boolean {
  const r = rec as Partial<License> | null;
  return typeof r?.key === 'string' && Array.isArray(r.paymentIds) && typeof r.paidUntil === 'number';
}

export function createLicenses(opts: LicensesOptions = {}): Licenses {
  const now = opts.now ?? Date.now;
  const generateKey = opts.generateKey ?? randomKey;
  const path = opts.path ?? process.env.LICENSES_PATH ?? '';

  const log: RecordLog<License> = createRecordLog<License>(path, (r) => r.key, isLicense);
  const byPayment = new Map<string, string>(); // payment id → licence key
  const byAccountId = new Map<string, string>(); // google sub → licence key
  for (const lic of log.values()) {
    for (const id of lic.paymentIds) byPayment.set(id, lic.key);
    if (lic.accountId) byAccountId.set(lic.accountId, lic.key);
  }

  function applyPayment(paymentId: string, plan: string, existingKey?: string): License {
    const alreadyApplied = byPayment.get(paymentId);
    if (alreadyApplied) {
      const existing = log.get(alreadyApplied);
      if (existing) return existing;
    }

    const key = existingKey ? normalizeKey(existingKey) : '';
    const current = key ? log.get(key) : undefined;
    // Own keys only — a prototype name as `plan` would make `days` a Function.
    const days = (Object.hasOwn(PLAN_DAYS, plan) ? PLAN_DAYS[plan] : undefined) ?? PLAN_DAYS[DEFAULT_PLAN] ?? 30;
    const ms = now();

    // Renewing early must ADD to the remaining time rather than restart the
    // clock from today — otherwise paying before the period ends silently
    // donates the unused days back to us.
    const base = current && current.paidUntil > ms ? current.paidUntil : ms;

    const license: License = {
      key: current ? current.key : key || generateKey(),
      plan,
      // Renewing keeps whoever already owns it.
      ...(current?.accountId ? { accountId: current.accountId } : {}),
      paidUntil: base + days * DAY_MS,
      paymentIds: [...(current?.paymentIds ?? []), paymentId],
      updatedAt: ms,
    };
    log.put(license);
    byPayment.set(paymentId, license.key);
    return license;
  }

  const verifier: PurchaseVerifier = async (purchaseToken) => {
    const license = log.get(normalizeKey(purchaseToken));
    // Null means "not a licence of ours" — the caller may then try another
    // adapter (a Google token, say) before calling the purchase invalid.
    if (!license) return null;
    return {
      productId: license.plan,
      expiresAt: license.paidUntil,
      state: license.paidUntil > now() ? 'active' : 'expired',
    };
  };

  function attachAccount(key: string, accountId: string): License | null {
    const license = log.get(normalizeKey(key));
    if (!license) return null;
    if (license.accountId && license.accountId !== accountId) return null;
    if (license.accountId === accountId) return license;
    const updated: License = { ...license, accountId, updatedAt: now() };
    log.put(updated);
    byAccountId.set(accountId, updated.key);
    return updated;
  }

  function snapshot(): Record<string, unknown> {
    const ms = now();
    let active = 0;
    let linked = 0;
    let granted = 0;
    for (const lic of log.values()) {
      if (lic.paidUntil > ms) active += 1;
      if (lic.accountId) linked += 1;
      if (lic.paymentIds.some((id) => id.startsWith(MANUAL_PAYMENT_PREFIX))) granted += 1;
    }
    return { licenses: log.size(), active, linked, granted };
  }

  return {
    applyPayment,
    byKey: (key) => log.get(normalizeKey(key)),
    byPaymentId: (paymentId) => {
      const key = byPayment.get(paymentId);
      return key ? log.get(key) : undefined;
    },
    byAccount: (accountId) => {
      const key = byAccountId.get(accountId);
      return key ? log.get(key) : undefined;
    },
    attachAccount,
    verifier,
    snapshot,
  };
}
