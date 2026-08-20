import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Request, Response } from 'express';

import { createInstallQuota } from '../src/installQuota.js';

/**
 * What the UTC day does and does not reset.
 *
 * Two separate concerns share this clock. The `/metrics` histogram is per-day:
 * the day rolls over inside the consume path, which only runs when a request
 * arrives, so on a quiet day (or on a single-user service between sessions) the
 * snapshot used to serve YESTERDAY's `installs_active` / `ip_fallback_active` /
 * usage as today's — the number the owner reads to see who is actually using
 * the app must describe the day it claims to describe.
 *
 * The BUDGETS split on the same boundary: the paid cap is a daily allowance and
 * must come back, the free tier is a one-off lifetime trial and must not. A
 * midnight that quietly refilled the trial would turn «30 разборов» in the UI
 * into «30 в день» in practice.
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
  const quota = createInstallQuota(noFail, { freeTotal: 30, now: c.now });

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

test('install quota: a new day does NOT refill the free trial', () => {
  const c = clock(Date.UTC(2026, 7, 1, 12));
  const quota = createInstallQuota(noFail, { freeTotal: 2, now: c.now });

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
  assert.equal(passed, 2, 'the trial is spent for good');

  // Spent, and still spent a month later.
  c.advanceDays(30);
  quota.middleware(req('device-bbbb-2222'), res(), next);
  assert.equal(passed, 2);
});

test('install quota: a new day DOES refill the paid budget', () => {
  const c = clock(Date.UTC(2026, 7, 1, 12));
  const quota = createInstallQuota(noFail, { freeTotal: 2, perDayPaid: 2, isPaid: () => true, now: c.now });

  let passed = 0;
  const next = () => {
    passed += 1;
  };
  quota.middleware(req('device-cccc-3333'), res(), next);
  quota.middleware(req('device-cccc-3333'), res(), next);
  quota.middleware(req('device-cccc-3333'), res(), next); // over today's cap
  assert.equal(passed, 2);

  c.advanceDays(1);
  quota.middleware(req('device-cccc-3333'), res(), next);
  assert.equal(passed, 3, 'a subscriber wakes up with a full day');
  const fresh = quota.snapshot() as unknown as QuotaSnapshot;
  assert.equal(fresh.installs_active, 1);
});

test('install quota: stateOf reports the applicable budget without spending it', () => {
  const c = clock(Date.UTC(2026, 7, 1, 12));
  const quota = createInstallQuota(noFail, { freeTotal: 30, perDayPaid: 5, now: c.now });

  const before = quota.stateOf(req('device-dddd-4444'));
  assert.deepEqual(before, { scope: 'total', cap: 30, used: 0, remaining: 30, freeTotal: 30, perDayPaid: 5 });

  quota.middleware(req('device-dddd-4444'), res(), () => undefined);
  const after = quota.stateOf(req('device-dddd-4444'));
  assert.equal(after?.used, 1);
  assert.equal(after?.remaining, 29);

  // Reading the number must not BE a parse: the subscription screen polls this
  // on every open, and a meter that charges for being read is a bug the user
  // would watch happen.
  assert.equal(quota.stateOf(req('device-dddd-4444'))?.remaining, 29);

  // No install id (the first seconds of a cold start, or an older build): the
  // ip lane still METERS the call, but it describes a crowd behind one CGNAT
  // address, so there is no honest «у вас осталось» to report.
  assert.equal(quota.stateOf(req(undefined)), null);
});
