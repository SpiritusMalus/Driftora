import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTranslations } from '../src/llm.js';
import { localizeAlternatives, localizeDraft, translateBatch } from '../src/nutrition/translateNames.js';
import type { MealDraft, NutritionAlternative } from '../src/types.js';

// --- parseTranslations: aligns model output to inputs, English on any mismatch.

test('parseTranslations aligns translations to inputs in order', () => {
  const data = { choices: [{ message: { content: JSON.stringify({ translations: ['Рис с молоком', 'Пшено'] }) } }] };
  assert.deepEqual(parseTranslations(data, ['Rice with Milk', 'Millet']), ['Рис с молоком', 'Пшено']);
});

test('parseTranslations falls back to English on length mismatch', () => {
  const data = { choices: [{ message: { content: JSON.stringify({ translations: ['Рис'] }) } }] };
  assert.deepEqual(parseTranslations(data, ['Rice with Milk', 'Millet']), ['Rice with Milk', 'Millet']);
});

test('parseTranslations falls back to English on malformed JSON', () => {
  const data = { choices: [{ message: { content: 'not json' } }] };
  assert.deepEqual(parseTranslations(data, ['Millet']), ['Millet']);
});

test('parseTranslations keeps the original for a blank entry', () => {
  const data = { choices: [{ message: { content: JSON.stringify({ translations: ['', 'Пшено'] }) } }] };
  assert.deepEqual(parseTranslations(data, ['Rice with Milk', 'Millet']), ['Rice with Milk', 'Пшено']);
});

test('parseTranslations strips ```json fences before parsing', () => {
  const data = { choices: [{ message: { content: '```json\n{"translations":["Овсянка"]}\n```' } }] };
  assert.deepEqual(parseTranslations(data, ['Oatmeal']), ['Овсянка']);
});

// --- translateBatch: cache + Cyrillic skip + single batched call (offline).

test('translateBatch skips Cyrillic labels and never calls the translator for them', async () => {
  let calls = 0;
  const map = await translateBatch(['Каша дружба', '  '], async (misses) => {
    calls += 1;
    return misses;
  });
  assert.equal(calls, 0, 'no misses → no translator call');
  assert.equal(map.size, 0, 'already-Russian labels are left untouched');
});

test('translateBatch batches misses into ONE call and maps results back', async () => {
  let calls = 0;
  const seen: string[][] = [];
  const map = await translateBatch(
    ['Fish Porridge Zzx', 'Rice Cereal Zzx', 'Fish Porridge Zzx'],
    async (misses) => {
      calls += 1;
      seen.push(misses);
      return misses.map((m) => `ru:${m}`);
    },
  );
  assert.equal(calls, 1, 'a single batched call for all unique misses');
  assert.deepEqual(seen[0], ['Fish Porridge Zzx', 'Rice Cereal Zzx'], 'dedup within the batch');
  assert.equal(map.get('Fish Porridge Zzx'), 'ru:Fish Porridge Zzx');
  assert.equal(map.get('Rice Cereal Zzx'), 'ru:Rice Cereal Zzx');
});

test('translateBatch serves a repeated label from cache on the next call', async () => {
  let calls = 0;
  const translate = async (misses: string[]) => {
    calls += 1;
    return misses.map((m) => `ru:${m}`);
  };
  await translateBatch(['Unique Label Qqx'], translate);
  const map = await translateBatch(['Unique Label Qqx'], translate);
  assert.equal(calls, 1, 'second sighting is a cache hit — translator not called again');
  assert.equal(map.get('Unique Label Qqx'), 'ru:Unique Label Qqx');
});

// --- localize*: the kill switch (TRANSLATE_DB_LABELS=0) makes them a safe no-op.

test('localizeDraft is a no-op when the kill switch is set', async () => {
  const prev = process.env.TRANSLATE_DB_LABELS;
  process.env.TRANSLATE_DB_LABELS = '0';
  try {
    const draft = {
      region: 'RU',
      items: [{ matched_name: 'Rice with Milk', alternatives: [{ name: 'Millet' }] }],
    } as unknown as MealDraft;
    const out = await localizeDraft(draft, 'RU');
    assert.equal(out, draft, 'returns the exact same object untouched');
  } finally {
    if (prev === undefined) delete process.env.TRANSLATE_DB_LABELS;
    else process.env.TRANSLATE_DB_LABELS = prev;
  }
});

test('localizeAlternatives is a no-op for a non-RU region', async () => {
  const list = [{ name: 'Millet' }] as unknown as NutritionAlternative[];
  const out = await localizeAlternatives(list, 'US');
  assert.equal(out, list);
});
