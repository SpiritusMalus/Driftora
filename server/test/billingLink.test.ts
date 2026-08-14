import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

import type { CreateAppOptions } from '../src/app.js';
const { createApp } = await import('../src/app.js');

/**
 * The behaviour being pinned here is the reason accounts exist at all: after
 * linking, a SECOND device gets the subscription without ever seeing the key.
 * That is what stops a licence from being a thing you can forward to a crowd.
 */

const ALICE = 'google-sub-alice';
const BOB = 'google-sub-bob';

async function startApp(opts: CreateAppOptions): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp(undefined, opts).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Tokens here are just names — the real crypto is covered in googleIdentity.test.ts. */
function fakeGoogle(map: Record<string, string>) {
  return async (idToken: string) => (map[idToken] ? { sub: map[idToken] } : null);
}

function post(base: string, path: string, body: unknown, installId: string): Promise<Response> {
  return realFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Install-Id': installId },
    body: JSON.stringify(body),
  });
}

const YOOKASSA_IP = '185.71.76.5';

/** Buy a licence the way production does: a settled payment through the webhook. */
async function buyLicence(base: string): Promise<string> {
  const res = await realFetch(`${base}/billing/yookassa/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': YOOKASSA_IP },
    body: JSON.stringify({ event: 'payment.succeeded', object: { id: 'pay-1' } }),
  });
  assert.equal(res.status, 200);
  const claim = await realFetch(`${base}/billing/license?payment_id=pay-1`);
  assert.equal(claim.status, 200);
  return ((await claim.json()) as { key: string }).key;
}

const BASE_OPTS: CreateAppOptions = {
  getYooKassaPayment: async (id) => ({ id, status: 'succeeded', metadata: { plan: 'monthly' } }),
  licensesPath: '',
  entitlementsPath: '',
};

test('link: a second device gets the subscription from the account, with no key', async () => {
  const { base, stop } = await startApp({
    ...BASE_OPTS,
    verifyGoogleIdToken: fakeGoogle({ 'tok-alice': ALICE }),
  });
  try {
    const key = await buyLicence(base);

    // Phone one: claim the licence for the account.
    const claim = await post(base, '/billing/link', { idToken: 'tok-alice', licenseKey: key }, 'install-1');
    assert.equal(claim.status, 200);
    assert.equal(((await claim.json()) as { active: boolean }).active, true);

    // Phone two: the same person, a new install, and NO key anywhere near it.
    const second = await post(base, '/billing/link', { idToken: 'tok-alice' }, 'install-2');
    assert.equal(second.status, 200);
    const body = (await second.json()) as { linked: boolean; active: boolean };
    assert.deepEqual({ linked: body.linked, active: body.active }, { linked: true, active: true });
  } finally {
    await stop();
  }
});

test('link: a licence already owned by someone else cannot be taken', async () => {
  const { base, stop } = await startApp({
    ...BASE_OPTS,
    verifyGoogleIdToken: fakeGoogle({ 'tok-alice': ALICE, 'tok-bob': BOB }),
  });
  try {
    const key = await buyLicence(base);
    assert.equal((await post(base, '/billing/link', { idToken: 'tok-alice', licenseKey: key }, 'install-aaaa-1')).status, 200);

    // Bob was forwarded Alice's key. This is exactly the case accounts exist to
    // stop, and it must fail the same way an unknown key does — otherwise the
    // endpoint answers "is this key taken?" for anyone who asks.
    const stolen = await post(base, '/billing/link', { idToken: 'tok-bob', licenseKey: key }, 'install-bbbb-2');
    assert.equal(stolen.status, 409);

    const unknown = await post(base, '/billing/link', { idToken: 'tok-bob', licenseKey: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, 'install-bbbb-2');
    assert.equal(unknown.status, 409);
    assert.deepEqual(await stolen.json(), await unknown.json(), 'the two answers must be indistinguishable');
  } finally {
    await stop();
  }
});

test('link: signing in with no purchase behind it is a plain "not subscribed"', async () => {
  const { base, stop } = await startApp({
    ...BASE_OPTS,
    verifyGoogleIdToken: fakeGoogle({ 'tok-alice': ALICE }),
  });
  try {
    const res = await post(base, '/billing/link', { idToken: 'tok-alice' }, 'install-aaaa-1');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: true, active: false, expires_at: 0, state: 'none' });
  } finally {
    await stop();
  }
});

test('link: an unverifiable token is 401, an unreachable Google is 503', async () => {
  const { base, stop } = await startApp({
    ...BASE_OPTS,
    verifyGoogleIdToken: async (token: string) => {
      if (token === 'boom') throw new Error('google down');
      return null;
    },
  });
  try {
    assert.equal((await post(base, '/billing/link', { idToken: 'forged' }, 'install-aaaa-1')).status, 401);

    // The distinction that matters: during a Google outage nobody may be told
    // their account is fake, because retrying is the correct behaviour.
    const outage = await post(base, '/billing/link', { idToken: 'boom' }, 'install-aaaa-1');
    assert.equal(outage.status, 503);
    assert.equal(((await outage.json()) as { error: { code: string } }).error.code, 'identity_unreachable');
  } finally {
    await stop();
  }
});

test('link: without an install id there is nothing to sign in', async () => {
  const { base, stop } = await startApp({
    ...BASE_OPTS,
    verifyGoogleIdToken: fakeGoogle({ 'tok-alice': ALICE }),
  });
  try {
    const res = await realFetch(`${base}/billing/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'tok-alice' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await stop();
  }
});

test('link: a deployment without Google identity says so, rather than pretending', async () => {
  const { base, stop } = await startApp(BASE_OPTS);
  try {
    const res = await post(base, '/billing/link', { idToken: 'anything' }, 'install-aaaa-1');
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'identity_unavailable');
  } finally {
    await stop();
  }
});
