import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { updateSettings } from '@/lib/core/db/settings';
import { ensureInstallId } from '@/lib/core/services/installId';
import {
  activateLicense,
  billingOrigin,
  checkoutUrl,
  claimLicenseKey,
  fetchPlans,
  normalizeLicenseKey,
  refreshEntitlement,
  startCheckout,
  storedLicenseKey,
} from '@/lib/core/services/billing';

/**
 * The rules this file pins down are the ones where being wrong costs someone
 * either money or their subscription:
 *
 *  · a key is stored ONLY after the server confirms it (a stored bad key is a
 *    permanent, wrong «у вас подписка» and a pointless call on every launch);
 *  · «сервер не ответил» is never reported as «ключ поддельный»;
 *  · the licence claim POLLS past 404, because the notification that mints it
 *    lands after the payer's browser is already back;
 *  · nothing touches the network without the cross-border AI consent.
 */

const ORIGIN = 'https://food.example';

async function makeDb(opts: { consent?: boolean } = {}) {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  await applySchema((s) => sqlite.exec(s));
  await ensureInstallId(db);
  await updateSettings(db, { aiFoodParseConsent: opts.consent ?? true });
  return { sqlite, db };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.EXPO_PUBLIC_FOOD_API_URL = `${ORIGIN}/food/parse`;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.EXPO_PUBLIC_FOOD_API_URL;
});

describe('billing endpoints', () => {
  it('derives the server origin from the parse endpoint', () => {
    expect(billingOrigin()).toBe(ORIGIN);
    expect(checkoutUrl()).toBe(`${ORIGIN}/billing/pay`);
  });

  it('has nowhere to sell when the build has no server', () => {
    delete process.env.EXPO_PUBLIC_FOOD_API_URL;
    expect(billingOrigin()).toBe('');
    expect(checkoutUrl()).toBe('');
  });

  it('accepts a key typed by hand, lowercase and spaced', () => {
    expect(normalizeLicenseKey('  abcd-efgh jklm-npqr ')).toBe('ABCD-EFGHJKLM-NPQR');
    expect(normalizeLicenseKey('abcd-efgh-jklm-npqr')).toBe('ABCD-EFGH-JKLM-NPQR');
  });
});

describe('activating a key', () => {
  it('stores the key only once the server has confirmed it', async () => {
    const { sqlite, db } = await makeDb();
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, { active: true, expires_at: 1_800_000_000_000, state: 'active' }),
    ) as unknown as typeof fetch;

    const result = await activateLicense(db, 'abcd-efgh-jklm-npqr');

    expect(result.ok).toBe(true);
    expect(await storedLicenseKey(db)).toBe('ABCD-EFGH-JKLM-NPQR');
    sqlite.close();
  });

  it('does not keep a key the server rejected', async () => {
    const { sqlite, db } = await makeDb();
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(402, { error: { code: 'invalid_purchase' } }),
    ) as unknown as typeof fetch;

    const result = await activateLicense(db, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');

    expect(result).toEqual({ ok: false, reason: 'invalid_key' });
    // Otherwise the app would claim a subscription forever and re-send the bad
    // key on every launch.
    expect(await storedLicenseKey(db)).toBeNull();
    sqlite.close();
  });

  it('separates "we sell nothing" from "the store could not be reached"', async () => {
    const { sqlite, db } = await makeDb();

    globalThis.fetch = jest.fn(async () =>
      jsonResponse(503, { error: { code: 'billing_unavailable' } }),
    ) as unknown as typeof fetch;
    expect(await activateLicense(db, 'ABCD-EFGH-JKLM-NPQR')).toEqual({ ok: false, reason: 'not_selling' });

    globalThis.fetch = jest.fn(async () =>
      jsonResponse(503, { error: { code: 'store_unreachable' } }),
    ) as unknown as typeof fetch;
    expect(await activateLicense(db, 'ABCD-EFGH-JKLM-NPQR')).toEqual({ ok: false, reason: 'unreachable' });

    // A refused key is the user's problem; an unreachable store is not, and
    // neither of those two answers may be reported as the other.
    expect(await storedLicenseKey(db)).toBeNull();
    sqlite.close();
  });

  it('reports a dead network as unknown, never as a fake purchase', async () => {
    const { sqlite, db } = await makeDb();
    globalThis.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    expect(await activateLicense(db, 'ABCD-EFGH-JKLM-NPQR')).toEqual({ ok: false, reason: 'unreachable' });
    sqlite.close();
  });
});

describe('the AI-consent gate', () => {
  it('makes no network call at all without the cross-border consent', async () => {
    const { sqlite, db } = await makeDb({ consent: false });
    const fetchMock = jest.fn(async () => jsonResponse(200, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await activateLicense(db, 'ABCD-EFGH-JKLM-NPQR');
    await fetchPlans(db);
    await startCheckout(db, { plan: 'monthly' });
    await refreshEntitlement(db);

    expect(fetchMock).not.toHaveBeenCalled();
    sqlite.close();
  });

  it('skips the launch refresh when there is no key to refresh', async () => {
    const { sqlite, db } = await makeDb();
    const fetchMock = jest.fn(async () => jsonResponse(200, {}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await refreshEntitlement(db);

    expect(fetchMock).not.toHaveBeenCalled();
    sqlite.close();
  });
});

describe('collecting the licence a payment bought', () => {
  it('polls past the 404 that means "the notification is still in flight"', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse(404, { error: { code: 'license_not_ready' } })
        : jsonResponse(200, { key: 'ABCD-EFGH-JKLM-NPQR', plan: 'monthly', paid_until: 1 });
    }) as unknown as typeof fetch;

    const key = await claimLicenseKey('pay-1', { attempts: 5, delayMs: 0, sleep: async () => {} });

    expect(key).toBe('ABCD-EFGH-JKLM-NPQR');
    expect(calls).toBe(3);
  });

  it('gives up rather than hanging, so the screen can offer a retry', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;

    expect(await claimLicenseKey('pay-1', { attempts: 3, delayMs: 0, sleep: async () => {} })).toBeNull();
  });
});

describe('starting a checkout', () => {
  it('hands back where to pay', async () => {
    const { sqlite, db } = await makeDb();
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, { payment_id: 'pay-9', confirmation_url: 'https://yoomoney/9', plan: 'monthly' }),
    ) as unknown as typeof fetch;

    expect(await startCheckout(db, { plan: 'monthly' })).toEqual({
      ok: true,
      paymentId: 'pay-9',
      confirmationUrl: 'https://yoomoney/9',
    });
    sqlite.close();
  });

  it('turns a missing receipt email into a field error, not a dead end', async () => {
    const { sqlite, db } = await makeDb();
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(400, { error: { code: 'email_required' } }),
    ) as unknown as typeof fetch;

    expect(await startCheckout(db, { plan: 'monthly' })).toEqual({ ok: false, reason: 'email_required' });
    sqlite.close();
  });
});
