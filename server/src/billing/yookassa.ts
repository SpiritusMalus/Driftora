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
