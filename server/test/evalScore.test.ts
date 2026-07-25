import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  compareToBaseline,
  percentile,
  scoreCase,
  summarize,
  type EvalCase,
  type EvalDraft,
} from '../eval/score.js';

function draft(over: Partial<EvalDraft> = {}): EvalDraft {
  return {
    items: [
      {
        name_ru: 'борщ',
        matched_name: 'Борщ из свежей капусты',
        per100: { source: 'skurikhin' },
        scaled: { kcal: 147 },
      },
    ],
    totals: { kcal: 147 },
    flags: { low_confidence: false, has_estimate: false, has_ai_estimate: false },
    ...over,
  };
}

const borsch: EvalCase = {
  id: 'ru-borsch',
  text: 'борщ',
  region: 'RU',
  note: 'smoke',
  expect: { minItems: 1, kcalRange: [60, 450], nameContains: ['борщ'], requireResolved: true },
};

test('a good parse passes every expectation', () => {
  const result = scoreCase(borsch, draft(), 900, 200);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.empty, false);
  assert.deepEqual(result.sources, ['skurikhin']);
});

test('an empty parse fails and is counted as empty', () => {
  const result = scoreCase(borsch, draft({ items: [], totals: { kcal: 0 } }), 500, 200);
  assert.equal(result.pass, false);
  assert.equal(result.empty, true);
  assert.ok(result.failures.some((f) => f.includes('items 0')));
});

test('an implausible total is caught — the «тархун» 974 kcal regression', () => {
  const tarhun: EvalCase = {
    id: 'ru-tarhun',
    text: 'лимонад тархун 0.5',
    region: 'RU',
    note: 'regression',
    expect: { minItems: 1, kcalRange: [40, 400] },
  };
  const result = scoreCase(
    tarhun,
    {
      items: [{ name_ru: 'Сушеный эстрагон', per100: { source: 'usda' }, scaled: { kcal: 974 } }],
      totals: { kcal: 974 },
    },
    800,
    200,
  );
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('974')));
});

test('an unrelated match is caught by nameContains even when the total looks sane', () => {
  const result = scoreCase(
    borsch,
    {
      items: [{ name_ru: 'Щи', matched_name: 'Щи из квашеной капусты', per100: { source: 'skurikhin' } }],
      totals: { kcal: 120 },
    },
    700,
    200,
  );
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('борщ')));
});

test('requireResolved rejects a fabricated estimate standing in for a DB row', () => {
  const result = scoreCase(
    borsch,
    {
      items: [{ name_ru: 'борщ', per100: { source: 'estimate' }, scaled: { kcal: 150 } }],
      totals: { kcal: 150 },
    },
    700,
    200,
  );
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((f) => f.includes('unresolved')));
});

test('a negative case passes precisely when nothing was invented', () => {
  const nonsense: EvalCase = {
    id: 'ru-nonsense',
    text: 'асдфгх',
    region: 'RU',
    note: 'negative',
    expect: { minItems: 0 },
  };
  assert.equal(scoreCase(nonsense, { items: [], totals: { kcal: 0 } }, 300, 200).pass, true);
  // Inventing food for gibberish is a failure of a different kind — but with
  // minItems 0 and no band, nothing here can catch it. Documented in cases.json.
  assert.equal(scoreCase(nonsense, draft(), 300, 200).pass, true);
});

test('a non-200 short-circuits to a single HTTP failure', () => {
  const result = scoreCase(borsch, null, 20_100, 429);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['HTTP 429']);
  assert.equal(result.empty, true);
});

test('percentile is nearest-rank, so every reported number was really observed', () => {
  const values = [100, 200, 300, 400, 500];
  assert.equal(percentile(values, 50), 300);
  assert.equal(percentile(values, 95), 500);
  assert.equal(percentile(values, 1), 100);
  assert.equal(percentile([], 95), 0);
});

test('summarize aggregates pass rate, empties, latency and provenance', () => {
  const results = [
    scoreCase(borsch, draft(), 100, 200),
    scoreCase(borsch, draft({ items: [], totals: { kcal: 0 } }), 900, 200),
  ];
  const summary = summarize(results);
  assert.equal(summary.total, 2);
  assert.equal(summary.passed, 1);
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.emptyRate, 0.5);
  assert.equal(summary.latencyMs.max, 900);
  assert.equal(summary.sourceCounts.skurikhin, 1);
  assert.equal(summary.failures.length, 1);
});

test('compareToBaseline flags real regressions and tolerates noise', () => {
  const baseline = summarize([scoreCase(borsch, draft(), 1000, 200)]);

  const same = summarize([scoreCase(borsch, draft(), 1200, 200)]);
  assert.deepEqual(compareToBaseline(same, baseline), []);

  const worse = summarize([scoreCase(borsch, draft({ items: [], totals: { kcal: 0 } }), 1000, 200)]);
  const regressions = compareToBaseline(worse, baseline);
  assert.ok(regressions.some((r) => r.startsWith('pass rate')));
  assert.ok(regressions.some((r) => r.startsWith('empty rate')));

  const slow = summarize([scoreCase(borsch, draft(), 5000, 200)]);
  assert.ok(compareToBaseline(slow, baseline).some((r) => r.startsWith('p95')));
});
