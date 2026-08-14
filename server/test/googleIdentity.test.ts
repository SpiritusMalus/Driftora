import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

const { createGoogleVerifier } = await import('../src/billing/googleIdentity.js');

/**
 * These tests sign real tokens with a real RSA key and hand them to the real
 * verifier — the point is that nothing here is mocked at the crypto layer,
 * because every interesting failure mode IS the crypto layer.
 */

const NOW = 1_800_000_000_000;
const CLIENT_ID = '627245153089-web.apps.googleusercontent.com';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

// A second key that Google never published — used to forge.
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(
  payload: Record<string, unknown>,
  opts: { header?: Record<string, unknown>; key?: ReturnType<typeof createPrivateKey> } = {},
): string {
  const header = { alg: 'RS256', kid: 'k1', typ: 'JWT', ...opts.header };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = createSign('RSA-SHA256').update(body).sign(opts.key ?? privateKey);
  return `${body}.${b64url(sig)}`;
}

function goodPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1029384756',
    exp: Math.floor(NOW / 1000) + 3600,
    email: 'someone@example.com',
    ...over,
  };
}

function jwksResponse(keys: unknown[], cacheControl = 'max-age=3600'): Response {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cacheControl },
  });
}

function verifierWith(keys: unknown[] = [jwk], onFetch?: () => void) {
  let calls = 0;
  const verify = createGoogleVerifier({
    clientIds: [CLIENT_ID],
    now: () => NOW,
    fetchImpl: (async () => {
      calls += 1;
      onFetch?.();
      return jwksResponse(keys);
    }) as unknown as typeof fetch,
  });
  return { verify, fetches: () => calls };
}

test('google: a properly signed token yields the account id and nothing else', async () => {
  const { verify } = verifierWith();
  const identity = await verify(sign(goodPayload()));
  // The email was in the token and is deliberately not returned: what we never
  // keep cannot leak and needs no line in the privacy policy.
  assert.deepEqual(identity, { sub: '1029384756' });
});

test('google: a token signed by someone else is refused', async () => {
  const { verify } = verifierWith();
  assert.equal(await verify(sign(goodPayload(), { key: other.privateKey })), null);
});

test('google: alg is pinned, so "none" and HS256 confusion are dead on arrival', async () => {
  const { verify } = verifierWith();

  // alg:none — the unsigned-token attack.
  const header = b64url(JSON.stringify({ alg: 'none', kid: 'k1', typ: 'JWT' }));
  const body = b64url(JSON.stringify(goodPayload()));
  assert.equal(await verify(`${header}.${body}.`), null);

  // alg:HS256 — asks us to verify an HMAC keyed with Google's PUBLIC key, which
  // the attacker also has. Refused because the algorithm is not read from here.
  assert.equal(await verify(sign(goodPayload(), { header: { alg: 'HS256' } })), null);
});

test('google: a token minted for another app is refused', async () => {
  const { verify } = verifierWith();
  // Correctly signed by Google — for somebody else's application. Signature
  // validity alone must never be enough.
  assert.equal(await verify(sign(goodPayload({ aud: 'someone-elses-client.apps.googleusercontent.com' }))), null);
});

test('google: issuer and expiry are enforced', async () => {
  const { verify } = verifierWith();
  assert.equal(await verify(sign(goodPayload({ iss: 'https://accounts.evil.test' }))), null);
  assert.equal(await verify(sign(goodPayload({ exp: Math.floor(NOW / 1000) - 1 }))), null);
  // Boundary: expiring exactly now is expired, not valid.
  assert.equal(await verify(sign(goodPayload({ exp: Math.floor(NOW / 1000) }))), null);
});

test('google: garbage in never throws, it just fails', async () => {
  const { verify } = verifierWith();
  for (const junk of ['', 'not-a-jwt', 'a.b', 'a.b.c', '..', `${b64url('{')}.x.y`]) {
    assert.equal(await verify(junk), null, `${junk} should be refused quietly`);
  }
});

test('google: the key set is cached, not fetched per sign-in', async () => {
  const { verify, fetches } = verifierWith();
  await verify(sign(goodPayload()));
  await verify(sign(goodPayload()));
  await verify(sign(goodPayload()));
  assert.equal(fetches(), 1, 'three sign-ins, one key fetch');
});

test('google: an unknown kid does not become a load generator against Google', async () => {
  const { verify, fetches } = verifierWith();
  await verify(sign(goodPayload())); // primes the cache
  const before = fetches();
  // A stream of tokens naming keys that do not exist: at most one extra refetch
  // within the floor, not one per token.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(await verify(sign(goodPayload(), { header: { kid: `made-up-${i}` } })), null);
  }
  assert.equal(fetches(), before, 'refetch is rate-limited');
});

test('google: reaching Google failing is an ERROR, not a verdict of "forged"', async () => {
  const verify = createGoogleVerifier({
    clientIds: [CLIENT_ID],
    now: () => NOW,
    fetchImpl: (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch,
  });
  // Must throw rather than return null: null means "this token is not real",
  // and answering that during a Google outage would sign out everyone who paid.
  await assert.rejects(() => verify(sign(goodPayload())), /network down/);
});
