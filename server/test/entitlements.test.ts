import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

import type { PurchaseVerification, PurchaseVerifier } from '../src/entitlements.js';
const { createEntitlements } = await import('../src/entitlements.js');
import type { CreateAppOptions } from '../src/app.js';
const { createApp } = await import('../src/app.js');

const HOUR = 3_600_000;

function verdict(over: Partial<PurchaseVerification> = {}): PurchaseVerification {
  return { productId: 'driftora.ai.monthly', expiresAt: Date.now() + 30 * 24 * HOUR, state: 'active', ...over };
}

/** Verifier that says yes to anything except the literal token 'forged'. */
const okVerifier: PurchaseVerifier = async (token) => (token === 'forged' ? null : verdict());

// ---------------------------------------------------------------- unit tests

test('entitlement: a verified purchase makes the bound install paid', async () => {
  const ent = createEntitlements({ verify: okVerifier, path: '' });
  assert.equal(ent.statusOf('install-1111').active, false);

  const res = await ent.register('token-abc', 'driftora.ai.monthly', 'install-1111');
  assert.equal(res.ok, true);
  assert.equal(res.active, true);
  assert.equal(ent.statusOf('install-1111').active, true);
  // Nobody else rides along on it.
  assert.equal(ent.statusOf('install-2222').active, false);
});

test('entitlement: the store’s product id wins over whatever the client claims', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'driftora-ent-'));
  const path = join(dir, 'entitlements.jsonl');
  try {
    const verify: PurchaseVerifier = async () => verdict({ productId: 'driftora.ai.monthly' });
    const ent = createEntitlements({ verify, path });
    // Client claims the expensive yearly SKU while holding a monthly token.
    await ent.register('token-abc', 'driftora.ai.yearly.premium', 'install-1111');

    // Read the stored record: the tier must be what the STORE said, never what
    // the app asked for, or the product id is just a client-supplied privilege.
    const stored = JSON.parse(readFileSync(path, 'utf8').trim()) as { productId: string };
    assert.equal(stored.productId, 'driftora.ai.monthly');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('entitlement: a device moving to a new purchase rebuilds the same way after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'driftora-ent-'));
  const path = join(dir, 'entitlements.jsonl');
  try {
    // The two purchases must differ in outcome, or this test passes whether or
    // not the device ends up pointing at the right one.
    const verify: PurchaseVerifier = async (token) =>
      token === 'token-old' ? verdict({ expiresAt: Date.now() - HOUR, state: 'expired' }) : verdict();

    const ent = createEntitlements({ verify, path });
    // The device renews under a fresh token; the dead subscription is then
    // written to the log AGAIN by another device. The last line about the old
    // purchase now sits after the new one — so a restart that trusts file order
    // hands this device back its expired subscription.
    await ent.register('token-old', 'p', 'install-1111');
    await ent.register('token-new', 'p', 'install-1111');
    await ent.register('token-old', 'p', 'install-2222');
    assert.equal(ent.statusOf('install-1111').active, true);

    const restarted = createEntitlements({ verify, path });
    assert.equal(restarted.statusOf('install-1111').active, true, 'restart must not resurrect the expired purchase');
    assert.equal(restarted.statusOf('install-2222').active, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('entitlement: a forged token is rejected and grants nothing', async () => {
  const ent = createEntitlements({ verify: okVerifier, path: '' });
  const res = await ent.register('forged', 'driftora.ai.monthly', 'install-1111');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid_purchase');
  assert.equal(ent.statusOf('install-1111').active, false);
});

test('entitlement: an unreachable store keeps the cached verdict instead of revoking it', async () => {
  let fail = false;
  const verify: PurchaseVerifier = async () => {
    if (fail) throw new Error('google is down');
    return verdict();
  };
  const ent = createEntitlements({ verify, path: '' });
  await ent.register('token-abc', 'driftora.ai.monthly', 'install-1111');
  assert.equal(ent.statusOf('install-1111').active, true);

  fail = true;
  const res = await ent.register('token-abc', 'driftora.ai.monthly', 'install-1111');
  assert.equal(res.reason, 'store_unreachable');
  // The paying user must NOT be downgraded because Google had a bad minute.
  assert.equal(res.active, true);
  assert.equal(ent.statusOf('install-1111').active, true);
});

test('entitlement: an expired period is not active, a cancelled-but-unexpired one is', async () => {
  const now = () => 1_000_000_000;
  const expired = createEntitlements({ verify: async () => verdict({ expiresAt: now() - HOUR }), path: '', now });
  await expired.register('t', 'p', 'install-1111');
  assert.equal(expired.statusOf('install-1111').active, false);

  // 'active' with a future expiry is how the adapter reports a cancelled sub
  // that still has paid time left — that time was bought and must be honoured.
  const cancelled = createEntitlements({ verify: async () => verdict({ expiresAt: now() + HOUR }), path: '', now });
  await cancelled.register('t', 'p', 'install-1111');
  assert.equal(cancelled.statusOf('install-1111').active, true);
});

test('entitlement: one purchase follows the person across phones, but not to a crowd', async () => {
  const ent = createEntitlements({ verify: okVerifier, path: '', maxInstalls: 2 });
  await ent.register('token-abc', 'p', 'install-1111');
  await ent.register('token-abc', 'p', 'install-2222');
  assert.equal(ent.statusOf('install-1111').active, true);
  assert.equal(ent.statusOf('install-2222').active, true);

  // A third device evicts the oldest rather than locking the owner out of their
  // own new phone.
  await ent.register('token-abc', 'p', 'install-3333');
  assert.equal(ent.statusOf('install-3333').active, true);
  assert.equal(ent.statusOf('install-1111').active, false, 'oldest binding should be evicted');
  assert.equal(ent.statusOf('install-2222').active, true);
});

test('entitlement: re-registering the same install does not consume a binding slot', async () => {
  const ent = createEntitlements({ verify: okVerifier, path: '', maxInstalls: 2 });
  // The client re-registers on every launch — that must not evict the user's
  // other device after two launches.
  for (let i = 0; i < 5; i += 1) await ent.register('token-abc', 'p', 'install-1111');
  await ent.register('token-abc', 'p', 'install-2222');
  assert.equal(ent.statusOf('install-1111').active, true);
  assert.equal(ent.statusOf('install-2222').active, true);
});

test('entitlement: a purchase survives a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'driftora-ent-'));
  const path = join(dir, 'entitlements.jsonl');
  try {
    const first = createEntitlements({ verify: okVerifier, path });
    await first.register('token-abc', 'driftora.ai.monthly', 'install-1111');
    assert.equal(first.statusOf('install-1111').active, true);

    // A deploy that silently downgrades everyone who paid is the whole reason
    // this store is on disk and the quota counter is not.
    const restarted = createEntitlements({ verify: okVerifier, path });
    assert.equal(restarted.statusOf('install-1111').active, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('entitlement: the raw purchase token is never written to disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'driftora-ent-'));
  const path = join(dir, 'entitlements.jsonl');
  try {
    const ent = createEntitlements({ verify: okVerifier, path });
    await ent.register('super-secret-purchase-token', 'driftora.ai.monthly', 'install-1111');
    const onDisk = readFileSync(path, 'utf8');
    assert.ok(!onDisk.includes('super-secret-purchase-token'), 'a leaked file must not be replayable as a purchase');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------- route behaviour

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const usdaHit = {
  foods: [
    {
      description: 'food',
      score: 80,
      foodNutrients: [
        { nutrientNumber: '1008', value: 150 },
        { nutrientNumber: '1003', value: 13 },
        { nutrientNumber: '1004', value: 10 },
        { nutrientNumber: '1005', value: 1 },
      ],
    },
  ],
};

async function startApp(opts: CreateAppOptions): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp(undefined, opts).listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function postText(base: string, installId: string): Promise<Response> {
  return realFetch(`${base}/food/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.55', 'X-Install-Id': installId },
    body: JSON.stringify({ text: 'омлет', region: 'US' }),
  });
}

function registerPurchase(base: string, installId: string | null, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.55' };
  if (installId) headers['X-Install-Id'] = installId;
  return realFetch(`${base}/billing/register`, { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return json({
        choices: [
          {
            message: {
              content: JSON.stringify({ items: [{ name_ru: 'яйцо', name_en: 'egg', est_grams: 100, confidence: 0.9 }] }),
            },
          },
        ],
      });
    }
    if (url.includes('api.nal.usda.gov')) return json(usdaHit);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('quota tier: buying raises the ceiling without refunding the day already spent', async () => {
  const { base, stop } = await startApp({
    limits: { textPerDay: 1000, burstPerMin: 1000 },
    aiQuotaPerDay: 1,
    aiQuotaPerDayPaid: 3,
    verifyPurchase: okVerifier,
    entitlementsPath: '',
  });
  try {
    const id = 'install-tier-1111';
    assert.equal((await postText(base, id)).status, 200);
    // Free ceiling reached.
    assert.equal((await postText(base, id)).status, 429);

    const reg = await registerPurchase(base, id, { purchaseToken: 'token-abc', productId: 'driftora.ai.monthly' });
    assert.equal(reg.status, 200);
    assert.equal(((await reg.json()) as { active?: boolean }).active, true);

    // Headroom, not a fresh budget: 1 of 3 was already spent, so 2 remain.
    const after = await postText(base, id);
    assert.equal(after.status, 200);
    assert.equal(after.headers.get('x-ai-quota-remaining'), '1');
    assert.equal((await postText(base, id)).status, 200);
    assert.equal((await postText(base, id)).status, 429);
  } finally {
    await stop();
  }
});

test('billing routes: forged purchase is 402, missing install id is 400, status reports the truth', async () => {
  const { base, stop } = await startApp({
    limits: { textPerDay: 1000, burstPerMin: 1000 },
    verifyPurchase: okVerifier,
    entitlementsPath: '',
  });
  try {
    const forged = await registerPurchase(base, 'install-x-1111', { purchaseToken: 'forged', productId: 'p' });
    assert.equal(forged.status, 402);
    assert.equal(((await forged.json()) as { error?: { code?: string } }).error?.code, 'invalid_purchase');

    const noId = await registerPurchase(base, null, { purchaseToken: 'token-abc', productId: 'p' });
    assert.equal(noId.status, 400);

    const status = await realFetch(`${base}/billing/status`, { headers: { 'X-Install-Id': 'install-x-1111' } });
    const body = (await status.json()) as { active?: boolean; billing_enabled?: boolean };
    assert.equal(body.billing_enabled, true);
    assert.equal(body.active, false);
  } finally {
    await stop();
  }
});

test('billing routes: a deployment that sells nothing says so instead of pretending', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, entitlementsPath: '' });
  try {
    const reg = await registerPurchase(base, 'install-x-1111', { purchaseToken: 'token-abc', productId: 'p' });
    assert.equal(reg.status, 503);
    const status = await realFetch(`${base}/billing/status`, { headers: { 'X-Install-Id': 'install-x-1111' } });
    assert.equal(((await status.json()) as { billing_enabled?: boolean }).billing_enabled, false);
  } finally {
    await stop();
  }
});
