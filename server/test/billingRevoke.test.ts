import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';
// Set BEFORE the import — APP_TOKEN is read once, at module load (see
// billingGrant.test.ts, whose gate discipline this file inherits).
process.env.APP_TOKEN = 'app-token-that-ships-inside-every-apk';

import type { CreateAppOptions } from '../src/app.js';
const { createApp } = await import('../src/app.js');

/**
 * What is pinned here: `/billing/revoke` and `/billing/licenses` sit behind the
 * SAME fail-closed admin gate as `/billing/grant`, and a revocation actually
 * ends access on the path a client really takes (`/billing/register`), rather
 * than only decorating the licence file.
 */

const APP_TOKEN = 'app-token-that-ships-inside-every-apk';
const ADMIN_TOKEN = 'admin-secret-long-enough-to-pass';

const BASE_OPTS: CreateAppOptions = {
  getYooKassaPayment: async (id) => ({ id, status: 'succeeded', metadata: { plan: 'monthly' } }),
  licensesPath: '',
  entitlementsPath: '',
};

async function startApp(adminToken: string | undefined): Promise<{ base: string; stop: () => Promise<void> }> {
  if (adminToken === undefined) delete process.env.BILLING_ADMIN_TOKEN;
  else process.env.BILLING_ADMIN_TOKEN = adminToken;
  const server = createApp(undefined, BASE_OPTS).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function post(base: string, path: string, token: string, body: unknown = {}): Promise<Response> {
  return realFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function register(base: string, key: string, installId: string): Promise<Response> {
  return realFetch(`${base}/billing/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${APP_TOKEN}`,
      'X-Install-Id': installId,
    },
    body: JSON.stringify({ purchaseToken: key, productId: 'monthly' }),
  });
}

interface Granted {
  key: string;
  paid_until: number;
}

interface Revoked {
  key: string;
  paid_until: number;
  revoked_at: number;
}

test('revoke: a granted key stops activating, and the record says why', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const granted = (await (await post(base, '/billing/grant', ADMIN_TOKEN, { reference: 'oops-1' })).json()) as Granted;

    // Sanity: the key works before the revocation.
    const before = await register(base, granted.key, 'install-revoke-1');
    assert.equal(before.status, 200);
    assert.equal(((await before.json()) as { active: boolean }).active, true);

    const res = await post(base, '/billing/revoke', ADMIN_TOKEN, { key: granted.key });
    assert.equal(res.status, 200);
    const revoked = (await res.json()) as Revoked;
    assert.equal(revoked.key, granted.key);
    assert.ok(revoked.revoked_at > 0);
    assert.ok(revoked.paid_until <= Date.now());

    // The path a real client takes on its next launch: re-register. The verdict
    // must be inactive AND honest about the reason.
    const after = await register(base, granted.key, 'install-revoke-1');
    assert.equal(after.status, 200);
    const status = (await after.json()) as { active: boolean; state: string };
    assert.equal(status.active, false);
    assert.equal(status.state, 'revoked');
  } finally {
    await stop();
  }
});

test('revoke: idempotent — the second call keeps the first timestamp', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const granted = (await (await post(base, '/billing/grant', ADMIN_TOKEN, { reference: 'oops-2' })).json()) as Granted;
    const first = (await (await post(base, '/billing/revoke', ADMIN_TOKEN, { key: granted.key })).json()) as Revoked;
    const second = (await (await post(base, '/billing/revoke', ADMIN_TOKEN, { key: granted.key })).json()) as Revoked;
    assert.equal(second.revoked_at, first.revoked_at);
  } finally {
    await stop();
  }
});

test('revoke: unknown key is a 404, an empty body a 400', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    assert.equal((await post(base, '/billing/revoke', ADMIN_TOKEN, { key: 'AAAA-AAAA-AAAA-AAAA' })).status, 404);
    assert.equal((await post(base, '/billing/revoke', ADMIN_TOKEN, {})).status, 400);
  } finally {
    await stop();
  }
});

test('revoke + list: the admin gate fails closed, exactly like /billing/grant', async () => {
  // No admin secret configured → both routes read as nonexistent, to the app
  // token and to nobody alike.
  const off = await startApp(undefined);
  try {
    assert.equal((await post(off.base, '/billing/revoke', APP_TOKEN, { key: 'X' })).status, 404);
    assert.equal(
      (await realFetch(`${off.base}/billing/licenses`, { headers: { Authorization: `Bearer ${APP_TOKEN}` } })).status,
      404,
    );
  } finally {
    await off.stop();
  }

  const on = await startApp(ADMIN_TOKEN);
  try {
    // The APK-embedded app token must not open an admin route.
    assert.equal((await post(on.base, '/billing/revoke', APP_TOKEN, { key: 'X' })).status, 401);
    assert.equal(
      (await realFetch(`${on.base}/billing/licenses`, { headers: { Authorization: `Bearer ${APP_TOKEN}` } })).status,
      401,
    );
  } finally {
    await on.stop();
  }
});

test('licenses list: shows what was issued, comped and revoked', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const kept = (await (await post(base, '/billing/grant', ADMIN_TOKEN, { reference: 'list-kept' })).json()) as Granted;
    const gone = (await (await post(base, '/billing/grant', ADMIN_TOKEN, { reference: 'list-gone' })).json()) as Granted;
    await post(base, '/billing/revoke', ADMIN_TOKEN, { key: gone.key });

    const res = await realFetch(`${base}/billing/licenses`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    assert.equal(res.status, 200);
    const { licenses } = (await res.json()) as {
      licenses: { key: string; active: boolean; granted: boolean; revoked_at?: number }[];
    };

    const keptRow = licenses.find((l) => l.key === kept.key);
    const goneRow = licenses.find((l) => l.key === gone.key);
    assert.ok(keptRow && goneRow);
    assert.equal(keptRow.active, true);
    assert.equal(keptRow.granted, true);
    assert.equal(keptRow.revoked_at, undefined);
    assert.equal(goneRow.active, false);
    assert.ok((goneRow.revoked_at ?? 0) > 0);
  } finally {
    await stop();
  }
});

test('funnel: the paywall beacon lands in /metrics with its source', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const readFunnel = async () => {
      const res = await realFetch(`${base}/metrics`, { headers: { Authorization: `Bearer ${APP_TOKEN}` } });
      return ((await res.json()) as { funnel: Record<string, number> & { paywall_sources: Record<string, number> } })
        .funnel;
    };
    // The metrics registry is process-global and other tests feed it too —
    // assert deltas, never absolutes.
    const before = await readFunnel();

    assert.equal((await post(base, '/funnel/paywall', APP_TOKEN, { source: 'limit' })).status, 200);
    assert.equal((await post(base, '/funnel/paywall', APP_TOKEN, { source: 'menu' })).status, 200);
    // Version skew must degrade to a coarse bucket, not to a lost data point.
    assert.equal((await post(base, '/funnel/paywall', APP_TOKEN, { source: 'from-mars' })).status, 200);

    const after = await readFunnel();
    assert.equal(after.paywall_shown, before.paywall_shown + 3);
    assert.equal(after.paywall_sources.limit, (before.paywall_sources.limit ?? 0) + 1);
    assert.equal(after.paywall_sources.menu, (before.paywall_sources.menu ?? 0) + 1);
    assert.equal(after.paywall_sources.other, (before.paywall_sources.other ?? 0) + 1);
  } finally {
    await stop();
  }
});
