import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Request, Response } from 'express';

import { createInstallQuota } from '../src/installQuota.js';

/**
 * The UTC day rolls over inside `middleware`, which only runs when a request
 * arrives. `/metrics` reads the same counters — so on a quiet day (or on a
 * single-user service between sessions) the snapshot kept serving YESTERDAY's
 * `installs_active` / `ip_fallback_active` / usage histogram as today's.
 *
 * That is the number the owner reads to see who is actually using the app, and
 * the distribution meant to size the free tier later. It must describe the day
 * it claims to describe.
 */

/** The two request fields the quota keys on. */
function req(installId?: string, ip = '198.51.100.7'): Request {
  return {
    ip,
    get: (name: string) => (name.toLowerCase() === 'x-install-id' ? installId : undefined),
  } as unknown as Request;
}

/** Swallows the headers the middleware sets; nothing here asserts on them. */
function res(): Response {
  return { setHeader: () => undefined } as unknown as Response;
}

const noFail = () => undefined;

/** A clock the test advances by whole UTC days. */
function clock(startMs: number) {
  let ms = startMs;
  return {
    now: () => ms,
    advanceDays: (n: number) => {
      ms += n * 86_400_000;
    },
  };
}

type QuotaSnapshot = {
  installs_active: number;
  ip_fallback_active: number;
  usage: Record<string, number>;
};

test('install quota: the snapshot describes today, not the last day with traffic', () => {
  const c = clock(Date.UTC(2026, 7, 1, 12));
  const quota = createInstallQuota(noFail, { perDay: 30, now: c.now });

  quota.middleware(req('device-aaaa-1111'), res(), () => undefined);
  quota.middleware(req(undefined, '198.51.100.9'), res(), () => undefined);

  const sameDay = quota.snapshot() as unknown as QuotaSnapshot;
  assert.equal(sameDay.installs_active, 1);
  assert.equal(sameDay.ip_fallback_active, 1);
  assert.equal(sameDay.usage['1-2'], 1);

  // Two quiet days later nothing has come in — and nothing is active.
  c.advanceDays(2);
  const quiet = quota.snapshot() as unknown as QuotaSnapshot;
  assert.equal(quiet.installs_active, 0);
  assert.equal(quiet.ip_fallback_active, 0);
  assert.equal(quiet.usage['1-2'], 0);
});

test('install quota: a new day starts every install with a full budget', () => {
  const c = clock(Date.UTC(2026, 7, 1, 12));
  const quota = createInstallQuota(noFail, { perDay: 2, now: c.now });

  let passed = 0;
  const next = () => {
    passed += 1;
  };
  quota.middleware(req('device-bbbb-2222'), res(), next);
  quota.middleware(req('device-bbbb-2222'), res(), next);
  quota.middleware(req('device-bbbb-2222'), res(), next); // over the cap
  assert.equal(passed, 2);

  c.advanceDays(1);
  quota.middleware(req('device-bbbb-2222'), res(), next);
  assert.equal(passed, 3);
  const fresh = quota.snapshot() as unknown as QuotaSnapshot;
  assert.equal(fresh.installs_active, 1);
});
