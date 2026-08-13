import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

const { isYooKassaAddress } = await import('../src/billing/yookassa.js');
const { createLicenses } = await import('../src/billing/licenses.js');
import type { YooKassaPayment } from '../src/billing/yookassa.js';
import type { CreateAppOptions } from '../src/app.js';
const { createApp } = await import('../src/app.js');

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

// --------------------------------------------------------- source-IP gate

test('yookassa ip gate: only the documented ranges are accepted', () => {
  for (const allowed of [
    '185.71.76.1',
    '185.71.76.31',
    '185.71.77.10',
    '77.75.153.0',
    '77.75.153.127',
    '77.75.156.11',
    '77.75.156.35',
    '77.75.154.200',
    '2a02:5180::1',
    '2a02:5180:ffff::abcd',
    // The form Node hands us for an IPv4 client behind a proxy.
    '::ffff:185.71.76.5',
  ]) {
    assert.equal(isYooKassaAddress(allowed), true, `${allowed} should be allowed`);
  }

  for (const denied of [
    '8.8.8.8',
    '185.71.76.32', // just past the /27
    '185.71.78.1', // adjacent /24, not ours
    '77.75.153.128', // just past the /25
    '77.75.156.12', // neighbour of a single allowed host
    '77.75.154.127', // just before the /25
    '2a02:5181::1', // adjacent /32
    '::1',
    'not-an-ip',
    '',
  ]) {
    assert.equal(isYooKassaAddress(denied), false, `${denied} should be denied`);
  }
});

// ------------------------------------------------------------- licences

test('licence: a payment issues a key good for the plan’s length', () => {
  const licenses = createLicenses({ path: '', now: () => NOW });
  const lic = licenses.applyPayment('pay-1', 'monthly');
  assert.match(lic.key, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal(lic.paidUntil, NOW + 30 * DAY);
  assert.equal(licenses.byKey(lic.key)?.key, lic.key);
});

test('licence: the same payment applied twice does not sell two months', () => {
  const licenses = createLicenses({ path: '', now: () => NOW });
  const first = licenses.applyPayment('pay-1', 'monthly');
  // ЮKassa redelivers for 24 hours until it sees a 200, so this WILL happen.
  const again = licenses.applyPayment('pay-1', 'monthly');
  assert.equal(again.key, first.key);
  assert.equal(again.paidUntil, first.paidUntil, 'redelivery must not extend the period');
});

test('licence: renewing early adds to the time left instead of restarting it', () => {
  let clock = NOW;
  const licenses = createLicenses({ path: '', now: () => clock });
  const first = licenses.applyPayment('pay-1', 'monthly');

  // Renew ten days in, with twenty still paid for.
  clock = NOW + 10 * DAY;
  const renewed = licenses.applyPayment('pay-2', 'monthly', first.key);
  assert.equal(renewed.key, first.key);
  assert.equal(renewed.paidUntil, first.paidUntil + 30 * DAY, 'the unused days must not be donated back to us');

  // Renewing after a lapse starts from today, not from the stale date.
  clock = NOW + 400 * DAY;
  const afterLapse = licenses.applyPayment('pay-3', 'monthly', first.key);
  assert.equal(afterLapse.paidUntil, clock + 30 * DAY);
});

test('licence: an unknown key is "not ours", an expired one is expired', async () => {
  let clock = NOW;
  const licenses = createLicenses({ path: '', now: () => clock });
  const lic = licenses.applyPayment('pay-1', 'monthly');

  // Null, not "invalid" — another adapter may still recognise the string.
  assert.equal(await licenses.verifier('NOPE-NOPE-NOPE-NOPE', 'p'), null);

  assert.equal((await licenses.verifier(lic.key, 'p'))?.state, 'active');
  // Typed by hand off a screen.
  assert.equal((await licenses.verifier(lic.key.toLowerCase(), 'p'))?.state, 'active');

  clock = NOW + 31 * DAY;
  assert.equal((await licenses.verifier(lic.key, 'p'))?.state, 'expired');
});

test('licence: an unknown plan falls back rather than granting forever', () => {
  const licenses = createLicenses({ path: '', now: () => NOW });
  const lic = licenses.applyPayment('pay-1', 'lifetime-please');
  assert.equal(lic.paidUntil, NOW + 30 * DAY);
});

// ------------------------------------------------------- webhook routes

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

const YOOKASSA_IP = '185.71.76.5';

function notify(base: string, ip: string, body: unknown): Promise<Response> {
  return realFetch(`${base}/billing/yookassa/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
}

const succeeded = { type: 'notification', event: 'payment.succeeded', object: { id: 'pay-1' } };

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

test('webhook: a notification from anywhere else is refused and sells nothing', async () => {
  const getYooKassaPayment = async (): Promise<YooKassaPayment> => ({ id: 'pay-1', status: 'succeeded' });
  const { base, stop } = await startApp({ getYooKassaPayment, licensesPath: '', entitlementsPath: '' });
  try {
    const res = await notify(base, '8.8.8.8', succeeded);
    assert.equal(res.status, 403);
    const claim = await realFetch(`${base}/billing/license?payment_id=pay-1`);
    assert.equal(claim.status, 404, 'a spoofed notification must not have issued a licence');
  } finally {
    await stop();
  }
});

test('webhook: the body claiming success is not enough — the API decides', async () => {
  // The whole point: anyone who reaches an allowed address could POST
  // "payment.succeeded". Only ЮKassa's own answer settles it.
  const getYooKassaPayment = async (): Promise<YooKassaPayment> => ({ id: 'pay-1', status: 'pending' });
  const { base, stop } = await startApp({ getYooKassaPayment, licensesPath: '', entitlementsPath: '' });
  try {
    const res = await notify(base, YOOKASSA_IP, succeeded);
    // 200: understood, nothing to do — no point in ЮKassa redelivering.
    assert.equal(res.status, 200);
    const claim = await realFetch(`${base}/billing/license?payment_id=pay-1`);
    assert.equal(claim.status, 404);
  } finally {
    await stop();
  }
});

test('webhook: an unverifiable payment answers 500 so ЮKassa retries', async () => {
  const getYooKassaPayment = async (): Promise<YooKassaPayment> => {
    throw new Error('yookassa is down');
  };
  const { base, stop } = await startApp({ getYooKassaPayment, licensesPath: '', entitlementsPath: '' });
  try {
    const res = await notify(base, YOOKASSA_IP, succeeded);
    assert.equal(res.status, 500, 'a paid customer left unactivated must be retried, not swallowed');
  } finally {
    await stop();
  }
});

test('webhook: events other than payment.succeeded are acknowledged and ignored', async () => {
  const getYooKassaPayment = async (): Promise<YooKassaPayment> => ({ id: 'pay-1', status: 'succeeded' });
  const { base, stop } = await startApp({ getYooKassaPayment, licensesPath: '', entitlementsPath: '' });
  try {
    const res = await notify(base, YOOKASSA_IP, { ...succeeded, event: 'payment.canceled' });
    assert.equal(res.status, 200);
    assert.equal((await realFetch(`${base}/billing/license?payment_id=pay-1`)).status, 404);
  } finally {
    await stop();
  }
});

test('paid path end to end: payment → licence key → paid AI cap', async () => {
  const getYooKassaPayment = async (id: string): Promise<YooKassaPayment> => ({
    id,
    status: 'succeeded',
    metadata: { plan: 'monthly' },
  });
  const { base, stop } = await startApp({
    limits: { textPerDay: 1000, burstPerMin: 1000 },
    aiQuotaPerDay: 1,
    aiQuotaPerDayPaid: 3,
    getYooKassaPayment,
    licensesPath: '',
    entitlementsPath: '',
  });
  try {
    const install = 'install-yk-1111';
    const postText = () =>
      realFetch(`${base}/food/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.90', 'X-Install-Id': install },
        body: JSON.stringify({ text: 'омлет', region: 'US' }),
      });

    assert.equal((await postText()).status, 200);
    assert.equal((await postText()).status, 429, 'free ceiling');

    // 1. ЮKassa reports a settled payment.
    assert.equal((await notify(base, YOOKASSA_IP, succeeded)).status, 200);

    // 2. The checkout page collects the key.
    const claim = await realFetch(`${base}/billing/license?payment_id=pay-1`);
    assert.equal(claim.status, 200);
    const { key } = (await claim.json()) as { key: string };
    assert.match(key, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);

    // 3. The app registers it through the SAME route a Google token would use.
    const reg = await realFetch(`${base}/billing/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.90', 'X-Install-Id': install },
      body: JSON.stringify({ purchaseToken: key, productId: 'monthly' }),
    });
    assert.equal(reg.status, 200);
    assert.equal(((await reg.json()) as { active?: boolean }).active, true);

    // 4. The ceiling is raised, and the day already spent is not refunded.
    const after = await postText();
    assert.equal(after.status, 200);
    assert.equal(after.headers.get('x-ai-quota-remaining'), '1');
  } finally {
    await stop();
  }
});

test('billing routes: a made-up licence key is rejected as an invalid purchase', async () => {
  const getYooKassaPayment = async (): Promise<YooKassaPayment> => ({ id: 'pay-1', status: 'succeeded' });
  const { base, stop } = await startApp({ getYooKassaPayment, licensesPath: '', entitlementsPath: '' });
  try {
    const reg = await realFetch(`${base}/billing/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Install-Id': 'install-yk-2222' },
      body: JSON.stringify({ purchaseToken: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', productId: 'monthly' }),
    });
    assert.equal(reg.status, 402);
  } finally {
    await stop();
  }
});

// ------------------------------------------------------------- checkout

const { createYooKassaPaymentCreator, formatAmount, resolvePrices } = await import('../src/billing/yookassa.js');

/** A fetch that records the one request it gets and answers like ЮKassa. */
function captureFetch(answer: unknown = { id: 'pay-new', confirmation: { confirmation_url: 'https://yoomoney/pay' } }) {
  const seen: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { seen, impl };
}

test('checkout: the payment carries the plan, the price and where to come back', async () => {
  const { seen, impl } = captureFetch();
  const create = createYooKassaPaymentCreator({
    shopId: 'shop',
    secretKey: 'secret',
    fetchImpl: impl,
    prices: { monthly: { amount: '199.00', description: 'месяц' }, yearly: { amount: '1990.00', description: 'год' } },
    newIdempotenceKey: () => 'fixed-key',
  });

  const payment = await create({ plan: 'yearly', returnUrl: 'https://food.example/billing/done' });
  assert.deepEqual(payment, { id: 'pay-new', confirmationUrl: 'https://yoomoney/pay', amount: '1990.00' });

  const [call] = seen;
  assert.ok(call);
  const body = JSON.parse(String(call.init.body)) as Record<string, any>;
  assert.equal(body.amount.value, '1990.00');
  assert.equal(body.amount.currency, 'RUB');
  assert.equal(body.capture, true);
  assert.equal(body.confirmation.return_url, 'https://food.example/billing/done');
  // The whole reason we create payments ourselves: the webhook reads this back.
  assert.deepEqual(body.metadata, { plan: 'yearly' });
  assert.equal(body.receipt, undefined, 'no receipt unless the shop asks for one');
  assert.equal((call.init.headers as Record<string, string>)['Idempotence-Key'], 'fixed-key');
});

test('checkout: a renewal names the licence it tops up; a receipt names the buyer', async () => {
  const { seen, impl } = captureFetch();
  const create = createYooKassaPaymentCreator({
    shopId: 'shop',
    secretKey: 'secret',
    fetchImpl: impl,
    prices: { monthly: { amount: '199.00', description: 'месяц' } },
    receipt: true,
    vatCode: 1,
  });

  await create({
    plan: 'monthly',
    returnUrl: 'https://food.example/billing/done',
    email: 'buyer@example.com',
    licenseKey: 'ABCD-EFGH-JKLM-NPQR',
  });

  const body = JSON.parse(String(seen[0]?.init.body)) as Record<string, any>;
  assert.deepEqual(body.metadata, { plan: 'monthly', license_key: 'ABCD-EFGH-JKLM-NPQR' });
  assert.equal(body.receipt.customer.email, 'buyer@example.com');
  assert.equal(body.receipt.items[0].amount.value, '199.00');
  assert.equal(body.receipt.items[0].vat_code, 1);
});

test('checkout: a 200 without a confirmation url is a failure, not a payment', async () => {
  const { impl } = captureFetch({ id: 'pay-new' });
  const create = createYooKassaPaymentCreator({
    shopId: 'shop',
    secretKey: 'secret',
    fetchImpl: impl,
    prices: { monthly: { amount: '199.00', description: 'месяц' } },
  });
  await assert.rejects(() => create({ plan: 'monthly', returnUrl: 'https://food.example/billing/done' }));
});

test('checkout: a broken price env falls back instead of selling for nothing', () => {
  assert.equal(formatAmount('249', 199), '249.00');
  assert.equal(formatAmount('', 199), '199.00');
  assert.equal(formatAmount('очень дорого', 199), '199.00');
  assert.equal(formatAmount('-5', 199), '199.00');
  assert.equal(resolvePrices({} as NodeJS.ProcessEnv).monthly?.amount, '199.00');
});

test('checkout route: an unknown plan is refused rather than quietly charged as monthly', async () => {
  const { base, stop } = await startApp({
    getYooKassaPayment: async (id) => ({ id, status: 'succeeded' }),
    createYooKassaPayment: async () => ({ id: 'pay-x', confirmationUrl: 'https://yoomoney/x', amount: '199.00' }),
    licensesPath: '',
    entitlementsPath: '',
  });
  try {
    const res = await realFetch(`${base}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'forever' }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).error.code, 'unknown_plan');
  } finally {
    await stop();
  }
});

test('checkout route: a licence key we never issued stops the sale', async () => {
  const { base, stop } = await startApp({
    getYooKassaPayment: async (id) => ({ id, status: 'succeeded' }),
    createYooKassaPayment: async () => ({ id: 'pay-x', confirmationUrl: 'https://yoomoney/x', amount: '199.00' }),
    licensesPath: '',
    entitlementsPath: '',
  });
  try {
    const res = await realFetch(`${base}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly', license_key: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ' }),
    });
    // Otherwise the typo itself becomes the new key and the buyer never finds it.
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as any).error.code, 'unknown_license');
  } finally {
    await stop();
  }
});

test('checkout route: the payer gets somewhere to pay, and comes back to us', async () => {
  const drafts: unknown[] = [];
  const { base, stop } = await startApp({
    getYooKassaPayment: async (id) => ({ id, status: 'succeeded' }),
    createYooKassaPayment: async (draft) => {
      drafts.push(draft);
      return { id: 'pay-77', confirmationUrl: 'https://yoomoney/77', amount: '199.00' };
    },
    licensesPath: '',
    entitlementsPath: '',
  });
  try {
    const res = await realFetch(`${base}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly', email: 'buyer@example.com' }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.payment_id, 'pay-77');
    assert.equal(body.confirmation_url, 'https://yoomoney/77');
    assert.match(String((drafts[0] as any).returnUrl), /\/billing\/done$/);
  } finally {
    await stop();
  }
});

test('checkout route: ЮKassa refusing to create the payment is not the payer’s fault', async () => {
  const { base, stop } = await startApp({
    getYooKassaPayment: async (id) => ({ id, status: 'succeeded' }),
    createYooKassaPayment: async () => {
      throw new Error('yookassa is down');
    },
    licensesPath: '',
    entitlementsPath: '',
  });
  try {
    const res = await realFetch(`${base}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    });
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as any).error.code, 'store_unreachable');
  } finally {
    await stop();
  }
});

test('checkout page: /billing/pay points at the one page that sells', async () => {
  const { base, stop } = await startApp({
    getYooKassaPayment: async (id) => ({ id, status: 'succeeded' }),
    createYooKassaPayment: async () => ({ id: 'p', confirmationUrl: 'u', amount: '199.00' }),
    licensesPath: '',
    entitlementsPath: '',
  });
  try {
    const res = await realFetch(`${base}/billing/pay`, { redirect: 'manual' });
    // The purchase page lives on the site now: keeping a second copy here meant a
    // second place for the price and the refund rules to go stale unnoticed.
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location') ?? '', /family-pie\.ru\/driftora\/subscription$/);
  } finally {
    await stop();
  }
});

test('return page is served even when the shop is switched off', async () => {
  const { base, stop } = await startApp({ licensesPath: '', entitlementsPath: '' });
  try {
    // A buyer returning from an older payment must still be able to read their key.
    assert.equal((await realFetch(`${base}/billing/done`)).status, 200);
    // …while the sale itself is honestly refused.
    const checkout = await realFetch(`${base}/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    });
    assert.equal(checkout.status, 503);
  } finally {
    await stop();
  }
});
