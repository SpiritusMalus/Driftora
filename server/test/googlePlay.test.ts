import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

const { createGooglePlayVerifier } = await import('../src/billing/googlePlay.js');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SERVICE_ACCOUNT = JSON.stringify({
  client_email: 'driftora@example.iam.gserviceaccount.com',
  private_key: privateKey,
});

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

interface Call {
  url: string;
  body?: string;
}

/**
 * Fake Google: answers the OAuth token exchange, then serves one canned
 * subscription lookup. Records every call so the tests can assert on what was
 * actually sent (JWT shape, token reuse).
 */
function fakeGoogle(purchase: unknown, status = 200): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 'ya29.fake', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(purchase), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function build(purchase: unknown, status = 200) {
  const { fetchImpl, calls } = fakeGoogle(purchase, status);
  const verify = createGooglePlayVerifier({
    serviceAccount: SERVICE_ACCOUNT,
    packageName: 'com.driftora.app',
    fetchImpl,
    now: () => NOW,
  });
  return { verify, calls };
}

test('google play: an active subscription maps to active with the store’s expiry', async () => {
  const { verify } = build({
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    lineItems: [{ productId: 'driftora.ai.monthly', expiryTime: new Date(NOW + 30 * 24 * HOUR).toISOString() }],
  });
  const result = await verify('token-abc', 'whatever.the.client.said');
  assert.ok(result);
  assert.equal(result.state, 'active');
  assert.equal(result.productId, 'driftora.ai.monthly', 'the store’s product must win over the client’s claim');
  assert.equal(result.expiresAt, NOW + 30 * 24 * HOUR);
});

test('google play: cancelled keeps access until the paid period actually ends', async () => {
  const stillPaid = build({
    subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
    lineItems: [{ productId: 'p', expiryTime: new Date(NOW + HOUR).toISOString() }],
  });
  assert.equal((await stillPaid.verify('t', 'p'))?.state, 'active', 'turning off renewal is not the end of the term');

  const lapsed = build({
    subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
    lineItems: [{ productId: 'p', expiryTime: new Date(NOW - HOUR).toISOString() }],
  });
  assert.equal((await lapsed.verify('t', 'p'))?.state, 'expired');
});

test('google play: grace keeps access, hold and pause do not', async () => {
  const cases: Array<[string, string]> = [
    ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'grace'],
    ['SUBSCRIPTION_STATE_ON_HOLD', 'paused'],
    ['SUBSCRIPTION_STATE_PAUSED', 'paused'],
    ['SUBSCRIPTION_STATE_EXPIRED', 'expired'],
    // Money has not settled — no paid tier, and no crash on a state we don't know.
    ['SUBSCRIPTION_STATE_PENDING', 'expired'],
    ['SOMETHING_GOOGLE_ADDED_LATER', 'expired'],
  ];
  for (const [googleState, expected] of cases) {
    const { verify } = build({
      subscriptionState: googleState,
      lineItems: [{ productId: 'p', expiryTime: new Date(NOW + 30 * 24 * HOUR).toISOString() }],
    });
    assert.equal((await verify('t', 'p'))?.state, expected, `${googleState} should map to ${expected}`);
  }
});

test('google play: a subscription with several line items lasts as long as the furthest', async () => {
  const { verify } = build({
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    lineItems: [
      { productId: 'p', expiryTime: new Date(NOW + HOUR).toISOString() },
      { productId: 'p', expiryTime: new Date(NOW + 10 * HOUR).toISOString() },
    ],
  });
  assert.equal((await verify('t', 'p'))?.expiresAt, NOW + 10 * HOUR);
});

test('google play: 404 is a definite "not ours", other failures are not', async () => {
  const notFound = build({ error: 'not found' }, 404);
  assert.equal(await notFound.verify('forged', 'p'), null);

  // A 500 (or a 400 from our own malformed request) must NOT be reported as a
  // fake purchase — that would accuse a paying customer of fraud.
  const broken = build({ error: 'boom' }, 500);
  await assert.rejects(() => broken.verify('t', 'p'), /purchase lookup failed: 500/);

  const badRequest = build({ error: 'bad' }, 400);
  await assert.rejects(() => badRequest.verify('t', 'p'), /purchase lookup failed: 400/);
});

test('google play: the access token is exchanged once and reused', async () => {
  const { verify, calls } = build({
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    lineItems: [{ productId: 'p', expiryTime: new Date(NOW + HOUR).toISOString() }],
  });
  await verify('t1', 'p');
  await verify('t2', 'p');

  const exchanges = calls.filter((c) => c.url.includes('oauth2.googleapis.com'));
  assert.equal(exchanges.length, 1, 'a token per lookup would be a self-inflicted rate limit');

  // The assertion must be a three-part JWT signed with the service account.
  const assertion = new URLSearchParams(exchanges[0]?.body ?? '').get('assertion') ?? '';
  const parts = assertion.split('.');
  assert.equal(parts.length, 3);
  const claims = JSON.parse(Buffer.from(parts[1] ?? '', 'base64url').toString()) as {
    iss: string;
    scope: string;
  };
  assert.equal(claims.iss, 'driftora@example.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');

  // And the lookup must be scoped to our package, with the token path-escaped.
  const lookups = calls.filter((c) => c.url.includes('androidpublisher'));
  assert.equal(lookups.length, 2);
  assert.ok(lookups[0]?.url.includes('/applications/com.driftora.app/'));
});

test('google play: a misconfigured service account fails loudly at construction', () => {
  assert.throws(() => createGooglePlayVerifier({ serviceAccount: '{"client_email":"only@example.com"}' }));
  // Silently selling nothing while looking healthy is the failure worth avoiding.
  assert.throws(() => createGooglePlayVerifier({ serviceAccount: '' }), /GOOGLE_SERVICE_ACCOUNT_JSON/);
});
