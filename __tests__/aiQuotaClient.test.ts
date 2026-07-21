/**
 * Client side of the per-install AI quota: the install-id header rides on
 * requests, a 429 `ai_quota_exceeded` becomes the honest `quota_exceeded` flag
 * (never «нет интернета»), and the X-AI-Quota-Remaining header lands in the
 * aiQuota store for the quiet «осталось N» line.
 */
import { afterEach, expect, jest, test } from '@jest/globals';

import { getAiQuotaRemaining, setAiQuotaRemaining } from '../lib/core/services/aiQuota';
import { HttpFoodParser } from '../lib/core/services/httpFoodParser';
import { newInstallId } from '../lib/core/services/installId';
import { StubFoodParser } from '../lib/core/services/stubFoodParser';

const realFetch = globalThis.fetch;

/** Smallest body that passes the parser's structural MealDraft guard. */
const validDraft = {
  region: 'RU',
  items: [],
  totals: { kcal: 0, prot: 0, fat: 0, carb: 0, minerals: {} },
  portion_state: 'estimated',
  approximate: false,
  flags: { has_estimate: false, low_confidence: false },
};

afterEach(() => {
  globalThis.fetch = realFetch;
  setAiQuotaRemaining(null);
});

test('newInstallId: 32 hex chars, unique per mint', () => {
  const a = newInstallId();
  const b = newInstallId();
  expect(a).toMatch(/^[0-9a-f]{32}$/);
  expect(b).toMatch(/^[0-9a-f]{32}$/);
  expect(a).not.toEqual(b);
});

test('parse: sends X-Install-Id and stores the remaining-budget header', async () => {
  const calls: { headers?: Record<string, string> }[] = [];
  globalThis.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push({ headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify(validDraft), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-AI-Quota-Remaining': '4' },
    });
  }) as unknown as typeof fetch;

  const parser = new HttpFoodParser('https://food.test/food/parse', new StubFoodParser(), undefined, {
    installId: () => 'device-test-1234',
  });
  const draft = await parser.parse('борщ', 'RU');

  expect(draft.region).toBe('RU');
  expect(calls[0]?.headers?.['X-Install-Id']).toBe('device-test-1234');
  expect(getAiQuotaRemaining()).toBe(4);
});

test('parse: 429 ai_quota_exceeded → quota_exceeded flag, not a generic offline lie', async () => {
  globalThis.fetch = jest.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'ai_quota_exceeded', message: 'quota' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;

  const parser = new HttpFoodParser('https://food.test/food/parse', new StubFoodParser(), undefined, {
    installId: () => 'device-test-1234',
  });
  const draft = await parser.parse('борщ', 'RU');

  expect(draft.flags.quota_exceeded).toBe(true);
  expect(draft.flags.offline_fallback).toBe(true);
  expect(getAiQuotaRemaining()).toBe(0);
});

test('parse: a generic 429 (per-IP rate limit) stays a server fallback, NOT a quota', async () => {
  globalThis.fetch = jest.fn(async () =>
    new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'slow down' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;

  const parser = new HttpFoodParser('https://food.test/food/parse', new StubFoodParser(), undefined, {});
  const draft = await parser.parse('борщ', 'RU');

  expect(draft.flags.quota_exceeded).toBeUndefined();
  expect(draft.flags.server_error).toBe(true);
});
