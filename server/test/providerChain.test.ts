import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProviders } from '../src/orchestrator.js';
import type { NutritionProvider } from '../src/nutrition/provider.js';
import type { Region } from '../src/types.js';

/** The per-region walk order the resolver will actually use (chainFor's rule). */
function chainNames(providers: NutritionProvider[], region: Region): string[] {
  return providers.filter((p) => p.regions.includes(region)).map((p) => p.name);
}

function withFatSecretEnv<T>(fn: () => T): T {
  const prevId = process.env.FATSECRET_CLIENT_ID;
  const prevSecret = process.env.FATSECRET_CLIENT_SECRET;
  process.env.FATSECRET_CLIENT_ID = 'test-id';
  process.env.FATSECRET_CLIENT_SECRET = 'test-secret';
  try {
    return fn();
  } finally {
    if (prevId === undefined) delete process.env.FATSECRET_CLIENT_ID;
    else process.env.FATSECRET_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.FATSECRET_CLIENT_SECRET;
    else process.env.FATSECRET_CLIENT_SECRET = prevSecret;
  }
}

test('RU chain: FatSecret sits right after the measured table, before USDA', () => {
  withFatSecretEnv(() => {
    const ru = chainNames(buildProviders(), 'RU');
    assert.equal(ru[0], 'skurikhin'); // the measured table always leads
    assert.equal(ru[1], 'fatsecret'); // RU-localized source beats the EN corpus
    assert.equal(ru[2], 'usda');
    // Exactly one FatSecret entry per region — the two wrappers share one
    // instance but must never both appear in the same chain.
    assert.equal(ru.filter((n) => n === 'fatsecret').length, 1);
  });
});

test('US chain: USDA still leads; FatSecret stays a late fallback', () => {
  withFatSecretEnv(() => {
    const us = chainNames(buildProviders(), 'US');
    assert.equal(us[0], 'usda');
    assert.equal(us.filter((n) => n === 'fatsecret').length, 1);
    // Later than USDA (and any community base) — the historical US position.
    assert.ok(us.indexOf('fatsecret') > us.indexOf('usda'));
    assert.ok(us.indexOf('fatsecret') < us.indexOf('openfoodfacts'));
  });
});

test('without credentials FatSecret is absent from both chains', () => {
  const prevId = process.env.FATSECRET_CLIENT_ID;
  const prevSecret = process.env.FATSECRET_CLIENT_SECRET;
  delete process.env.FATSECRET_CLIENT_ID;
  delete process.env.FATSECRET_CLIENT_SECRET;
  try {
    const providers = buildProviders();
    assert.ok(!chainNames(providers, 'RU').includes('fatsecret'));
    assert.ok(!chainNames(providers, 'US').includes('fatsecret'));
  } finally {
    if (prevId !== undefined) process.env.FATSECRET_CLIENT_ID = prevId;
    if (prevSecret !== undefined) process.env.FATSECRET_CLIENT_SECRET = prevSecret;
  }
});

test('the RU wrapper delegates to the same instance (shared token cache)', async () => {
  await withFatSecretEnv(async () => {
    const providers = buildProviders();
    const ruFs = providers.find((p) => p.name === 'fatsecret' && p.regions.includes('RU'));
    const usFs = providers.find((p) => p.name === 'fatsecret' && p.regions.includes('US'));
    assert.ok(ruFs && usFs);
    assert.notEqual(ruFs, usFs); // two chain slots…
    // …but both keep the provider contract the resolver relies on.
    assert.equal(ruFs.queryLang, 'en');
    assert.equal(ruFs.acceptsCyrillic, true);
    assert.equal(typeof ruFs.searchMany, 'function');
  });
});
