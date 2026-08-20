import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

import type { CreateAppOptions } from '../src/app.js';
const { createApp } = await import('../src/app.js');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function llmReply(items: unknown[]): Response {
  return json({ choices: [{ message: { content: JSON.stringify({ items }) } }] });
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

/** POST text as a given client IP + install id (the CGNAT scenario needs both knobs). */
function postText(base: string, ip: string, installId?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip };
  if (installId) headers['X-Install-Id'] = installId;
  return realFetch(`${base}/food/parse`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'омлет', region: 'US' }),
  });
}

beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      return llmReply([{ name_ru: 'яйцо', name_en: 'egg', est_grams: 100, confidence: 0.9 }]);
    }
    if (url.includes('api.nal.usda.gov')) return json(usdaHit);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('install quota: the free trial counts down once, and running out is 429 with no promise of tomorrow', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 2 });
  try {
    const ip = '203.0.113.20';
    const a = await postText(base, ip, 'device-aaaa-1111');
    assert.equal(a.status, 200);
    assert.equal(a.headers.get('x-ai-quota-remaining'), '1');
    assert.equal(a.headers.get('x-ai-quota-scope'), 'total');
    const b = await postText(base, ip, 'device-aaaa-1111');
    assert.equal(b.status, 200);
    assert.equal(b.headers.get('x-ai-quota-remaining'), '0');

    const over = await postText(base, ip, 'device-aaaa-1111');
    assert.equal(over.status, 429);
    assert.equal(over.headers.get('x-ai-quota-remaining'), '0');
    assert.equal(over.headers.get('x-ai-quota-scope'), 'total');
    // A spent lifetime trial has no reset to wait for. Retry-After here would
    // send well-behaved clients into a loop against a wall, and would tell the
    // user «завтра заработает» about a budget that never comes back.
    assert.equal(over.headers.get('retry-after'), null);
    const body = (await over.json()) as { error?: { code?: string } };
    assert.equal(body.error?.code, 'ai_quota_exceeded');
  } finally {
    await stop();
  }
});

test('install quota: the free trial survives a restart (a lifetime cap held in memory is no cap)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-quota-'));
  const path = join(dir, 'quota.jsonl');
  const id = 'device-ffff-6666';
  const ip = '203.0.113.60';
  try {
    const first = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 2, aiQuotaPath: path });
    try {
      assert.equal((await postText(first.base, ip, id)).status, 200);
      assert.equal((await postText(first.base, ip, id)).status, 200);
    } finally {
      await first.stop();
    }

    // Same install, brand-new process: the deploy must not hand back a trial the
    // user already spent — that is the whole difference between a lifetime cap
    // and a rumour of one.
    const second = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 2, aiQuotaPath: path });
    try {
      const over = await postText(second.base, ip, id);
      assert.equal(over.status, 429);
      // A different install on the same restarted server is untouched.
      assert.equal((await postText(second.base, ip, 'device-gggg-7777')).status, 200);
    } finally {
      await second.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install quota: two installs behind ONE IP meter independently (the CGNAT case per-IP caps break)', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 1 });
  try {
    const sharedIp = '198.51.100.7';
    const a = await postText(base, sharedIp, 'device-aaaa-1111');
    assert.equal(a.status, 200);
    const aOver = await postText(base, sharedIp, 'device-aaaa-1111');
    assert.equal(aOver.status, 429);

    // Same exit IP, different install — must NOT inherit the neighbour's spend.
    const b = await postText(base, sharedIp, 'device-bbbb-2222');
    assert.equal(b.status, 200);
  } finally {
    await stop();
  }
});

test('install quota: clients without an id fall back to a DAILY ip-scoped budget', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 1 });
  try {
    const first = await postText(base, '192.0.2.33');
    assert.equal(first.status, 200);
    // Daily, NOT lifetime: an exit address is a crowd under CGNAT, so a trial
    // spent forever would ban an entire mobile operator once thirty strangers
    // behind it had eaten breakfast.
    assert.equal(first.headers.get('x-ai-quota-scope'), 'day');
    const second = await postText(base, '192.0.2.33');
    assert.equal(second.status, 429);
    assert.ok(Number(second.headers.get('retry-after')) > 0);
    // A different IP without an id is a fresh fallback bucket.
    const other = await postText(base, '192.0.2.34');
    assert.equal(other.status, 200);
  } finally {
    await stop();
  }
});

test('install quota: /metrics exposes the anonymous usage histogram, never ids', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 5 });
  try {
    await postText(base, '203.0.113.40', 'device-cccc-3333');
    await postText(base, '203.0.113.40', 'device-cccc-3333');
    await postText(base, '203.0.113.41', 'device-dddd-4444');
    await postText(base, '203.0.113.42'); // no id → ip fallback bucket

    const res = await realFetch(`${base}/metrics`);
    assert.equal(res.status, 200);
    const snap = (await res.json()) as { ai_quota?: Record<string, unknown> };
    const q = snap.ai_quota as {
      free_total: number;
      installs_active: number;
      ip_fallback_active: number;
      installs_known: number;
      installs_exhausted: number;
      quota_hits: number;
      usage: Record<string, number>;
    };
    assert.equal(q.free_total, 5);
    assert.equal(q.installs_active, 2);
    assert.equal(q.ip_fallback_active, 1);
    assert.equal(q.installs_known, 2);
    // Nobody has hit the wall yet — this is the paywall funnel's numerator.
    assert.equal(q.installs_exhausted, 0);
    assert.equal(q.usage['1-2'], 2);
    // No raw ids anywhere in the snapshot (privacy §2 — aggregate only).
    assert.ok(!JSON.stringify(snap).includes('device-cccc-3333'));
  } finally {
    await stop();
  }
});

test('install quota: /billing/status carries the numbers the subscription screen states', async () => {
  const { base, stop } = await startApp({
    limits: { textPerDay: 1000, burstPerMin: 1000 },
    aiQuotaFreeTotal: 5,
    aiQuotaPerDayPaid: 7,
  });
  try {
    const id = 'device-hhhh-8888';
    const read = async (installId: string | null) => {
      const res = await realFetch(`${base}/billing/status`, {
        headers: installId ? { 'X-Install-Id': installId } : {},
      });
      return (await res.json()) as { ai_quota?: Record<string, unknown> | null };
    };

    // Both caps travel, not just the applicable one: the screen has to say what
    // a subscription BUYS as well as what is left of the trial.
    assert.deepEqual((await read(id)).ai_quota, {
      scope: 'total',
      cap: 5,
      used: 0,
      remaining: 5,
      free_total: 5,
      per_day_paid: 7,
    });

    await postText(base, '203.0.113.70', id);
    const after = (await read(id)).ai_quota as { used: number; remaining: number };
    assert.equal(after.used, 1);
    assert.equal(after.remaining, 4);

    // Nothing to attribute a budget to — better silent than confidently wrong.
    assert.equal((await read(null)).ai_quota, null);
  } finally {
    await stop();
  }
});

test('install quota: 0 disables the layer entirely', async () => {
  const { base, stop } = await startApp({ limits: { textPerDay: 1000, burstPerMin: 1000 }, aiQuotaFreeTotal: 0 });
  try {
    for (let i = 0; i < 4; i += 1) {
      const res = await postText(base, '203.0.113.50', 'device-eeee-5555');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('x-ai-quota-remaining'), null);
    }
  } finally {
    await stop();
  }
});
