import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';
// Set BEFORE the import: `APP_TOKEN` is read once, at module load, exactly as in
// production. The point of half these tests is what happens when the admin
// secret is confused with this one.
process.env.APP_TOKEN = 'app-token-that-ships-inside-every-apk';

import type { CreateAppOptions } from '../src/app.js';
const { createApp } = await import('../src/app.js');

/**
 * What is pinned here is the difference between an admin route and a giveaway.
 *
 * `/billing/grant` mints paid access, and the only thing between it and every
 * holder of an APK is a secret that is NOT the app token. So the tests care less
 * about the happy path than about the three ways the gate can be left open:
 * no secret, a short secret, and the app's own secret pasted in.
 */

const APP_TOKEN = 'app-token-that-ships-inside-every-apk';
const ADMIN_TOKEN = 'admin-secret-long-enough-to-pass';

const BASE_OPTS: CreateAppOptions = {
  getYooKassaPayment: async (id) => ({ id, status: 'succeeded', metadata: { plan: 'monthly' } }),
  licensesPath: '',
  entitlementsPath: '',
};

async function startApp(adminToken: string | undefined): Promise<{ base: string; stop: () => Promise<void> }> {
  // Resolved inside createApp, so each app gets the env as it stands now.
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

function grant(base: string, token: string, body: unknown = {}): Promise<Response> {
  return realFetch(`${base}/billing/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

interface Granted {
  key: string;
  plan: string;
  paid_until: number;
  reference: string;
}

const DAY_MS = 86_400_000;

test('grant: an issued key actually activates the subscription', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const res = await grant(base, ADMIN_TOKEN, { plan: 'yearly', reference: 'support-2026-08-23' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Granted;
    assert.match(body.key, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
    assert.equal(body.plan, 'yearly');
    assert.equal(body.reference, 'manual:support-2026-08-23');
    assert.ok(body.paid_until > Date.now() + 364 * DAY_MS);

    // The whole point: the key must survive the same path a bought one takes.
    const activate = await realFetch(`${base}/billing/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${APP_TOKEN}`,
        'X-Install-Id': 'install-granted-1',
      },
      body: JSON.stringify({ purchaseToken: body.key, productId: 'yearly' }),
    });
    assert.equal(activate.status, 200);
    assert.equal(((await activate.json()) as { active: boolean }).active, true);
  } finally {
    await stop();
  }
});

test('grant: without BILLING_ADMIN_TOKEN the route issues nothing', async () => {
  const { base, stop } = await startApp(undefined);
  try {
    // Fails CLOSED, unlike requireToken, which treats an unset secret as "local
    // deployment, let it through". Here that reading would give the whole
    // internet a free subscription tap.
    assert.equal((await grant(base, '')).status, 404);
    assert.equal((await grant(base, APP_TOKEN)).status, 404);
  } finally {
    await stop();
  }
});

test('grant: the app token is refused as the admin secret', async () => {
  // The realistic misconfiguration: the owner already has APP_TOKEN in .env and
  // pastes it here. That token is inlined into every APK, so accepting it would
  // publish this route to all users.
  const { base, stop } = await startApp(APP_TOKEN);
  try {
    assert.equal((await grant(base, APP_TOKEN)).status, 404);
  } finally {
    await stop();
  }
});

test('grant: a short admin secret leaves the route off', async () => {
  const { base, stop } = await startApp('admin123');
  try {
    assert.equal((await grant(base, 'admin123')).status, 404);
  } finally {
    await stop();
  }
});

test('grant: a wrong secret is rejected', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    assert.equal((await grant(base, 'not-the-admin-secret-but-long')).status, 401);
    assert.equal((await grant(base, '')).status, 401);
  } finally {
    await stop();
  }
});

test('grant: the same reference twice hands out one licence, not two months', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const first = (await (await grant(base, ADMIN_TOKEN, { reference: 'refund-77' })).json()) as Granted;
    const again = (await (await grant(base, ADMIN_TOKEN, { reference: 'refund-77' })).json()) as Granted;
    // A retried curl, or a script re-run after a timeout, must be free.
    assert.deepEqual(again, first);
  } finally {
    await stop();
  }
});

test('grant: extending an existing licence adds to what is left', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const first = (await (await grant(base, ADMIN_TOKEN, { plan: 'monthly' })).json()) as Granted;
    const extended = (await (await grant(base, ADMIN_TOKEN, { plan: 'monthly', key: first.key })).json()) as Granted;
    assert.equal(extended.key, first.key);
    // Not a clock restarted from today: the remaining days are kept.
    assert.ok(extended.paid_until - first.paid_until >= 29 * DAY_MS);
  } finally {
    await stop();
  }
});

test('grant: a mistyped key is refused rather than minting an orphan licence', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    const res = await grant(base, ADMIN_TOKEN, { key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unknown_license');
  } finally {
    await stop();
  }
});

test('grant: the note survives in the audit trail, in any script', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    // "Пете за баг" flattened to ASCII would be a record of nothing, which is
    // the one job `reference` has besides idempotency.
    const res = await grant(base, ADMIN_TOKEN, { reference: 'Пете за баг 23.08' });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as Granted).reference, 'manual:Пете за баг 23.08');

    const quoted = await grant(base, ADMIN_TOKEN, { reference: 'сло"мать' });
    assert.equal(quoted.status, 400);
  } finally {
    await stop();
  }
});

test('grant: an unknown plan is refused, never silently shortened', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    // "yearley" must not quietly become 30 days — the recipient would be told
    // they have a year and lose access eleven months early.
    const res = await grant(base, ADMIN_TOKEN, { plan: 'yearley' });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'unknown_plan');
  } finally {
    await stop();
  }
});

test('grant: hand-issued licences are counted apart in /metrics', async () => {
  const { base, stop } = await startApp(ADMIN_TOKEN);
  try {
    await grant(base, ADMIN_TOKEN, { reference: 'comp-1' });
    const res = await realFetch(`${base}/metrics`, { headers: { Authorization: `Bearer ${APP_TOKEN}` } });
    const body = (await res.json()) as { billing?: { licenses?: number; granted?: number } };
    assert.equal(body.billing?.licenses, 1);
    // Free access nobody counts is how a support gesture becomes the business model.
    assert.equal(body.billing?.granted, 1);
  } finally {
    await stop();
  }
});
