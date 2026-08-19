import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

/**
 * The round trip the whole feature is for: one person confirms a local dish, and
 * the next person finds it by typing the name. Plus the two things that must
 * hold at the edge — a refusal never becomes an error the user has to see, and
 * the request's own identity never reaches the file on disk.
 */

const realFetch = globalThis.fetch;
const STORE = join(mkdtempSync(join(tmpdir(), 'driftora-community-route-')), 'foods.jsonl');

// Read at import time by app.ts, so it has to be set before the dynamic import.
process.env.COMMUNITY_FOODS_PATH = STORE;

const { createApp } = await import('../src/app.js');

async function startApp(): Promise<{ base: string; stop: () => Promise<void> }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function post(base: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return realFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // Every external nutrition source answers "nothing" — this suite is about the
  // shared base, and a local dish is precisely what the real ones do not have.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a dish one person confirms is what the next person finds', async () => {
  const { base, stop } = await startApp();
  try {
    const added = await post(base, '/food/contribute', {
      name: 'Шаурма с курицей',
      region: 'RU',
      per100: { kcal: 215, prot: 12, fat: 11, carb: 16 },
    });
    assert.equal(added.status, 200);
    assert.deepEqual(await added.json(), { ok: true, votes: 1 });

    const found = await post(base, '/food/search', { query: 'шаурма с курицей', region: 'RU' });
    const { candidates } = (await found.json()) as { candidates: { name: string; per100: { source: string; kcal: number }; votes?: number }[] };
    const row = candidates.find((c) => c.per100.source === 'community');
    assert.ok(row, `expected a community row, got ${JSON.stringify(candidates)}`);
    assert.equal(row.name, 'Шаурма с курицей');
    assert.equal(row.per100.kcal, 215);
    assert.equal(row.votes, 1, 'the count rides along so the picker can be honest about it');
  } finally {
    await stop();
  }
});

test('a second confirmation pulls the number toward the middle, not toward the newest', async () => {
  const { base, stop } = await startApp();
  try {
    for (const kcal of [280, 300, 900]) {
      await post(base, '/food/contribute', {
        name: 'Хачапури по-аджарски',
        region: 'RU',
        // 900 kcal is refused by the gate before it can count — it cannot be
        // reconciled with these macros — so the median stays where it belongs.
        per100: { kcal, prot: 11, fat: 14, carb: 28 },
      });
    }
    const found = await post(base, '/food/search', { query: 'хачапури по-аджарски', region: 'RU' });
    const { candidates } = (await found.json()) as { candidates: { per100: { source: string; kcal: number }; votes?: number }[] };
    const row = candidates.find((c) => c.per100.source === 'community');
    assert.equal(row?.per100.kcal, 290);
    assert.equal(row?.votes, 2, 'the implausible third entry never counted');
  } finally {
    await stop();
  }
});

test('a refused contribution is an ordinary answer, never an error the user sees', async () => {
  const { base, stop } = await startApp();
  try {
    for (const body of [
      { name: 'заходи на shop.example', region: 'RU', per100: { kcal: 200, prot: 8, fat: 8, carb: 24 } },
      { name: 'Плов', region: 'RU', per100: { kcal: 9000, prot: 8, fat: 8, carb: 24 } },
      { name: '', region: 'RU', per100: {} },
      {},
    ]) {
      const res = await post(base, '/food/contribute', body);
      assert.equal(res.status, 200, `expected 200 for ${JSON.stringify(body)}`);
      assert.deepEqual(await res.json(), { ok: true, votes: 0 });
    }
  } finally {
    await stop();
  }
});

test('stores the food and nothing that could point back at whoever sent it', async () => {
  const { base, stop } = await startApp();
  try {
    await post(
      base,
      '/food/contribute',
      {
        name: 'Сырники бабушкины',
        region: 'RU',
        per100: { kcal: 220, prot: 12, fat: 10, carb: 20 },
        // Fields the client has no business sending — and which must not be
        // stored even when it does.
        installId: 'deadbeefdeadbeefdeadbeefdeadbeef',
        ts: 1_760_000_000_000,
        rawText: 'сырники на завтрак, 3 штуки',
      },
      { 'X-Install-Id': 'deadbeefdeadbeefdeadbeefdeadbeef' },
    );

    const raw = readFileSync(STORE, 'utf8');
    assert.match(raw, /Сырники бабушкины/);
    assert.doesNotMatch(raw, /deadbeef/, 'no install id');
    assert.doesNotMatch(raw, /1760000000000/, 'no timestamp');
    assert.doesNotMatch(raw, /завтрак/, 'no meal text');
  } finally {
    await stop();
  }
});
