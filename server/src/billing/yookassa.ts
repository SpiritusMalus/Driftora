import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { DEFAULT_PLAN, PLAN_DAYS, type Licenses } from './licenses.js';

/**
 * ЮKassa adapter for direct sales: a settled payment becomes a licence key, and
 * the key is what the app hands to `/billing/register`.
 *
 * TWO RULES FROM ЮKASSA'S OWN DOCS drive the shape of this file:
 *
 * 1. Notifications are authenticated BY SOURCE IP — there is no signature to
 *    check. So the allowlist below is the whole gate, and it must be exact.
 * 2. The notification body is a hint, not evidence: the docs say to re-read the
 *    payment through the API to confirm its current status. Anyone who can spoof
 *    an allowed IP would otherwise mint themselves subscriptions by POSTing
 *    `{"event":"payment.succeeded"}`. We therefore trust only what the API says
 *    when asked directly.
 *
 * ЮKassa redelivers a notification for 24 hours until it gets a 200, so a
 * transient failure here must answer non-200 (retry me), while "understood,
 * nothing to do" must answer 200 — see the handler.
 */

/** Source IPs ЮKassa sends notifications from (yookassa.ru/developers/using-api/webhooks). */
export const YOOKASSA_CIDRS = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.156.11/32',
  '77.75.156.35/32',
  '77.75.154.128/25',
  '2a02:5180::/32',
] as const;

const API_BASE = 'https://api.yookassa.ru/v3';

interface Addr {
  family: 4 | 6;
  value: bigint;
}

function parseIPv4(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIPv6(input: string): bigint | null {
  let ip = input.split('%')[0] ?? '';
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hex groups.
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${((v4 >> 16n) & 0xffffn).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const left = (halves[0] ?? '').split(':').filter(Boolean);
  const right = halves.length === 2 ? (halves[1] ?? '').split(':').filter(Boolean) : [];
  let groups: string[];
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    groups = left;
  } else {
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  }
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

/** IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is the form Node hands us behind a proxy. */
// Layout: bits 0–31 are the IPv4 address, bits 32–47 are 0xffff, the rest zero.
// The mask must therefore clear only the low 32 bits — clearing 48 would drop
// the 0xffff marker itself and never match.
const V4_MAPPED_PREFIX = 0xffffn << 32n;
const V4_MAPPED_MASK = (1n << 128n) - (1n << 32n);

export function parseAddr(ip: string): Addr | null {
  if (ip.includes(':')) {
    const value = parseIPv6(ip);
    if (value === null) return null;
    if ((value & V4_MAPPED_MASK) === V4_MAPPED_PREFIX) return { family: 4, value: value & 0xffffffffn };
    return { family: 6, value };
  }
  const value = parseIPv4(ip);
  return value === null ? null : { family: 4, value };
}

function inCidr(addr: Addr, cidr: string): boolean {
  const [net = '', lenRaw = ''] = cidr.split('/');
  const netAddr = parseAddr(net);
  if (!netAddr || netAddr.family !== addr.family) return false;
  const total = addr.family === 4 ? 32 : 128;
  const len = Number(lenRaw);
  if (!Number.isInteger(len) || len < 0 || len > total) return false;
  const shift = BigInt(total - len);
  return addr.value >> shift === netAddr.value >> shift;
}

/** Whether a notification really came from ЮKassa. The only authentication there is. */
export function isYooKassaAddress(ip: string | undefined, cidrs: readonly string[] = YOOKASSA_CIDRS): boolean {
  if (!ip) return false;
  const addr = parseAddr(ip);
  if (!addr) return false;
  return cidrs.some((cidr) => inCidr(addr, cidr));
}

export interface YooKassaPayment {
  id: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface YooKassaClientOptions {
  shopId?: string;
  secretKey?: string;
  fetchImpl?: typeof fetch;
}

/** Reads a payment back from ЮKassa. Throws on anything but a clean answer. */
export function createYooKassaClient(opts: YooKassaClientOptions = {}): (id: string) => Promise<YooKassaPayment> {
  const shopId = opts.shopId ?? process.env.YOOKASSA_SHOP_ID ?? '';
  const secretKey = opts.secretKey ?? process.env.YOOKASSA_SECRET_KEY ?? '';
  const doFetch = opts.fetchImpl ?? fetch;
  if (!shopId || !secretKey) throw new Error('YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY are not set');

  const auth = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;

  return async function getPayment(id: string): Promise<YooKassaPayment> {
    const res = await doFetch(`${API_BASE}/payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`yookassa payment lookup failed: ${res.status}`);
    return (await res.json()) as YooKassaPayment;
  };
}

/* ------------------------------------------------------------------------- *
 * Creating a payment — the half of the flow a webhook can never do.
 *
 * The webhook above reacts to a payment that already exists; something has to
 * MAKE one, or the only way to buy is a link pasted by hand from the ЮKassa
 * dashboard. A dashboard link cannot carry `metadata.plan` or
 * `metadata.license_key`, so it can neither sell a yearly plan nor top up an
 * existing licence — both of which the webhook already knows how to honour.
 * ------------------------------------------------------------------------- */

/** One purchasable plan, priced the way ЮKassa wants it: a decimal string. */
export interface PlanPrice {
  /** Roubles, always two decimals ("199.00") — ЮKassa rejects bare integers. */
  amount: string;
  /** Shown on the payment page and the receipt. ЮKassa caps this at 128 chars. */
  description: string;
}

const DEFAULT_PRICE_RUB: Record<string, number> = { monthly: 199, yearly: 1990 };
const DESCRIPTION_MAX = 128;

/**
 * Read a price override. Anything that is not a positive finite number falls
 * back to the default rather than throwing: a typo in an env var must not take
 * the whole service down, and the default is a defensible price, not zero.
 */
export function formatAmount(raw: string | undefined, fallbackRub: number): string {
  const n = Number(raw);
  return (Number.isFinite(n) && n > 0 ? n : fallbackRub).toFixed(2);
}

/** Prices for every plan `licenses.ts` knows about, from `BILLING_PRICE_*`. */
export function resolvePrices(env: NodeJS.ProcessEnv = process.env): Record<string, PlanPrice> {
  const out: Record<string, PlanPrice> = {};
  for (const [plan, days] of Object.entries(PLAN_DAYS)) {
    const amount = formatAmount(env[`BILLING_PRICE_${plan.toUpperCase()}`], DEFAULT_PRICE_RUB[plan] ?? 199);
    out[plan] = {
      amount,
      description: `Driftora — ИИ-разборы еды, ${days} дней`.slice(0, DESCRIPTION_MAX),
    };
  }
  return out;
}

export interface CheckoutDraft {
  plan: string;
  /** Where ЮKassa sends the browser back once the payer is done. */
  returnUrl: string;
  /** Buyer's email — required only when receipts are on (54-ФЗ). */
  email?: string;
  /** Renewing an existing licence rather than starting a new one. */
  licenseKey?: string;
}

export interface CreatedPayment {
  id: string;
  confirmationUrl: string;
  amount: string;
}

export interface PaymentCreatorOptions extends YooKassaClientOptions {
  prices?: Record<string, PlanPrice>;
  /**
   * Send a 54-ФЗ receipt with the payment. On for a shop with a cash register
   * attached in ЮKassa — where a payment WITHOUT a receipt is rejected — and off
   * for a shop that issues receipts elsewhere, where sending one duplicates it.
   * Only the shop owner knows which, hence a setting rather than a guess.
   */
  receipt?: boolean;
  /** 1 = «без НДС» — the right code for the ИП-on-УСН this ships for. */
  vatCode?: number;
  /** Injectable for deterministic tests. */
  newIdempotenceKey?: () => string;
}

/**
 * Build the "create a payment" call, or throw when the shop is not configured.
 *
 * IDEMPOTENCE KEY IS PER CALL, deliberately. ЮKassa uses it to collapse a
 * RETRY of one logical request; two taps on «Оплатить» are two intents to pay,
 * and only one of them will ever be completed. Reusing a key across taps would
 * instead hand the second tap the first payment's confirmation URL — including
 * after that payment was cancelled, which is a dead end the payer cannot leave.
 */
export function createYooKassaPaymentCreator(
  opts: PaymentCreatorOptions = {},
): (draft: CheckoutDraft) => Promise<CreatedPayment> {
  const shopId = opts.shopId ?? process.env.YOOKASSA_SHOP_ID ?? '';
  const secretKey = opts.secretKey ?? process.env.YOOKASSA_SECRET_KEY ?? '';
  const doFetch = opts.fetchImpl ?? fetch;
  if (!shopId || !secretKey) throw new Error('YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY are not set');

  const prices = opts.prices ?? resolvePrices();
  const withReceipt = opts.receipt ?? process.env.BILLING_RECEIPT === '1';
  const vatCode = opts.vatCode ?? (Number(process.env.BILLING_VAT_CODE) || 1);
  const newKey = opts.newIdempotenceKey ?? (() => randomUUID());
  const auth = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;

  return async function createPayment(draft: CheckoutDraft): Promise<CreatedPayment> {
    const plan = draft.plan in prices ? draft.plan : DEFAULT_PLAN;
    const price = prices[plan];
    if (!price) throw new Error(`no price configured for plan "${plan}"`);

    const amount = { value: price.amount, currency: 'RUB' };
    const body: Record<string, unknown> = {
      amount,
      capture: true,
      confirmation: { type: 'redirect', return_url: draft.returnUrl },
      description: price.description,
      // Read back verbatim by the webhook — this is the whole reason a payment
      // has to be created by us rather than from a dashboard link.
      metadata: draft.licenseKey ? { plan, license_key: draft.licenseKey } : { plan },
    };
    if (withReceipt) {
      body.receipt = {
        customer: { email: draft.email },
        items: [
          {
            description: price.description,
            quantity: '1.00',
            amount,
            vat_code: vatCode,
            payment_subject: 'service',
            payment_mode: 'full_prepayment',
          },
        ],
      };
    }

    const res = await doFetch(`${API_BASE}/payments`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
        'Idempotence-Key': newKey(),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`yookassa payment create failed: ${res.status}`);

    const payment = (await res.json()) as {
      id?: unknown;
      confirmation?: { confirmation_url?: unknown };
    };
    const id = typeof payment.id === 'string' ? payment.id : '';
    const confirmationUrl =
      typeof payment.confirmation?.confirmation_url === 'string' ? payment.confirmation.confirmation_url : '';
    // A 200 without somewhere to send the payer is not a usable payment. Failing
    // here surfaces it as "could not start the payment" instead of a checkout
    // page that redirects to `undefined`.
    if (!id || !confirmationUrl) throw new Error('yookassa payment create: no confirmation url');

    return { id, confirmationUrl, amount: price.amount };
  };
}

export interface WebhookOptions {
  licenses: Licenses;
  getPayment: (id: string) => Promise<YooKassaPayment>;
  /** Override the allowlist (tests). */
  cidrs?: readonly string[];
}

/**
 * Handles `POST /billing/yookassa/webhook`.
 *
 * Status codes here are a PROTOCOL, not decoration: 200 means "stop resending",
 * anything else means "resend for up to 24 hours". So a payment we cannot yet
 * verify must fail loudly rather than be quietly acknowledged and lost.
 */
export function createYooKassaWebhook(opts: WebhookOptions) {
  const cidrs = opts.cidrs ?? YOOKASSA_CIDRS;

  return async function handle(req: Request, res: Response): Promise<void> {
    if (!isYooKassaAddress(req.ip, cidrs)) {
      // Not ЮKassa. Retrying is meaningless, so this is a flat refusal.
      res.status(403).json({ error: { code: 'forbidden', message: 'Not a ЮKassa source address.' } });
      return;
    }

    const body = (req.body ?? {}) as { event?: unknown; object?: { id?: unknown } };
    const event = typeof body.event === 'string' ? body.event : '';
    const paymentId = typeof body.object?.id === 'string' ? body.object.id : '';
    if (!paymentId) {
      res.status(400).json({ error: { code: 'invalid_notification', message: 'Missing object.id.' } });
      return;
    }

    // Every other event (waiting_for_capture, canceled, refunds) is acknowledged
    // and ignored — access already sold is honoured to its paid-until date.
    if (event !== 'payment.succeeded') {
      res.status(200).json({ ok: true, ignored: event });
      return;
    }

    let payment: YooKassaPayment;
    try {
      payment = await opts.getPayment(paymentId);
    } catch (err) {
      // 500 on purpose: ЮKassa will redeliver, and a paid customer who is not
      // yet activated is a bug we want retried, not swallowed.
      console.error('yookassa: payment lookup failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: { code: 'store_unreachable', message: 'Could not verify the payment.' } });
      return;
    }

    // The notification claimed success; only the API's own answer settles it.
    if (payment.status !== 'succeeded') {
      res.status(200).json({ ok: true, ignored: payment.status });
      return;
    }

    const metadata = payment.metadata ?? {};
    const claimedPlan = typeof metadata.plan === 'string' ? metadata.plan : DEFAULT_PLAN;
    const plan = claimedPlan in PLAN_DAYS ? claimedPlan : DEFAULT_PLAN;
    // Present when the buyer is renewing an existing licence rather than
    // starting a new one; absent on a first purchase.
    const existingKey = typeof metadata.license_key === 'string' ? metadata.license_key : undefined;

    const license = opts.licenses.applyPayment(payment.id, plan, existingKey);
    // The key itself never goes in the response: ЮKassa ignores the body, and
    // the buyer collects it from /billing/license instead.
    res.status(200).json({ ok: true, paid_until: license.paidUntil });
  };
}

/** Verifier over issued licences — the adapter `/billing/register` consults. */
export function createYooKassaVerifier(licenses: Licenses) {
  return licenses.verifier;
}
