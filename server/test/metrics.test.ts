import assert from 'node:assert/strict';
import { test } from 'node:test';

import { metrics } from '../src/metrics.js';
import { assembleMealDraft, scaleToGrams, type NutritionItem, type Per100 } from '../src/types.js';

const usda: Per100 = { source: 'usda', kcal: 165, prot: 31, fat: 3.6, carb: 0, minerals: {} };
const est: Per100 = { source: 'estimate', kcal: 150, prot: 5, fat: 5, carb: 20, minerals: {} };

function draftWith(per100: Per100, confidence: number) {
  const item: NutritionItem = {
    name_ru: 'x', name_en: 'x', grams: 100, grams_source: 'estimated',
    confidence, per100, scaled: scaleToGrams(per100, 100), approximate: true,
  };
  return assembleMealDraft('US', [item]);
}

test('recordParse increments requests, region, source, and latency', () => {
  const before = metrics.snapshot();
  metrics.recordParse('text', 'US', draftWith(usda, 0.9), 20);
  const after = metrics.snapshot();

  assert.equal(after.requests.text, (before.requests.text ?? 0) + 1);
  assert.equal(after.by_region.US, before.by_region.US + 1);
  assert.equal(after.sources.usda, before.sources.usda + 1);
  assert.equal(after.latency_ms.text!.count, before.latency_ms.text!.count + 1);
});

test('recordParse counts low_confidence and estimate-source draws', () => {
  const before = metrics.snapshot();
  metrics.recordParse('photo', 'RU', draftWith(est, 0.2), 30);
  const after = metrics.snapshot();

  assert.equal(after.low_confidence, before.low_confidence + 1);
  assert.equal(after.sources.estimate, before.sources.estimate + 1);
  assert.equal(after.requests.photo, (before.requests.photo ?? 0) + 1);
});

test('recordEscalation increments the escalation counter', () => {
  const before = metrics.snapshot();
  metrics.recordEscalation();
  assert.equal(metrics.snapshot().escalations, before.escalations + 1);
});

test('recordFailure counts the strain when one is given', () => {
  const before = metrics.snapshot();
  metrics.recordFailure('photo', 'llm_unavailable', 'timeout');
  metrics.recordFailure('photo', 'llm_unavailable', 'truncated');
  metrics.recordFailure('text', 'llm_unavailable', 'timeout');
  metrics.recordFailure('text', 'internal_error');
  const after = metrics.snapshot();

  assert.equal(after.failures_by_strain.timeout, (before.failures_by_strain.timeout ?? 0) + 2);
  assert.equal(after.failures_by_strain.truncated, (before.failures_by_strain.truncated ?? 0) + 1);
  assert.equal(after.failures_by_reason.llm_unavailable, (before.failures_by_reason.llm_unavailable ?? 0) + 3);
  // internal_error carries no strain — the strain table stays untouched by it.
  assert.equal(
    Object.values(after.failures_by_strain).reduce((a, b) => a + b, 0),
    Object.values(before.failures_by_strain).reduce((a, b) => a + b, 0) + 3,
  );
});

test('recordFunnel counts steps and paywall sources', () => {
  const before = metrics.snapshot();
  metrics.recordFunnel('paywall_shown', 'limit');
  metrics.recordFunnel('paywall_shown', 'menu');
  metrics.recordFunnel('paywall_shown', 'limit');
  metrics.recordFunnel('checkout_started');
  metrics.recordFunnel('payments_succeeded');
  const after = metrics.snapshot();

  assert.equal(after.funnel.paywall_shown, before.funnel.paywall_shown + 3);
  assert.equal(after.funnel.checkout_started, before.funnel.checkout_started + 1);
  assert.equal(after.funnel.payments_succeeded, before.funnel.payments_succeeded + 1);
  const src = after.funnel.paywall_sources as Record<string, number>;
  const srcBefore = before.funnel.paywall_sources as Record<string, number>;
  assert.equal(src.limit, (srcBefore.limit ?? 0) + 2);
  assert.equal(src.menu, (srcBefore.menu ?? 0) + 1);
});

/**
 * ХВОСТ, А НЕ СРЕДНЕЕ — и ДВА числа, а не одно.
 *
 * Здесь же зафиксирована граница самого p95, чтобы его не читали как «самый
 * медленный ответ»: одиночный выброс из двадцати — это ровно те 5%, которые
 * перцентиль по определению отсекает. Назвать его может только `max`. Поэтому
 * в снапшот выведены оба: p95 говорит, как живёт подавляющее большинство,
 * max — что вообще случалось. Порог по одному p95 пропустил бы редкий, но
 * реальный обрыв связи; порог по одному max орал бы на любой единичный сбой.
 */
test('одиночный выброс называет max, а p95 честно остаётся низким', () => {
  assert.equal(metrics.snapshot().stage_ms['tail_one']?.count ?? 0, 0);
  for (let i = 0; i < 19; i += 1) metrics.recordStage('tail_one', 1_500);
  metrics.recordStage('tail_one', 60_000);

  const s = metrics.snapshot().stage_ms['tail_one']!;
  assert.equal(s.count, 20);
  assert.ok(s.avg < 5_000, `среднее выглядит здоровым: ${s.avg} ms`);
  assert.equal(s.p95, 2_000, '19 из 20 — это ровно 95%, выброс за перцентилем');
  assert.equal(s.max, 60_000, 'а max называет его точно, без округления по корзинам');
});

test('устойчивый медленный хвост поднимает p95 — то, чего среднее не показывает', () => {
  assert.equal(metrics.snapshot().stage_ms['tail_many']?.count ?? 0, 0);
  // 16 быстрых и 4 медленных: среднее ≈ 12.8 с, и по нему маршрут ещё «в норме»,
  // хотя каждый пятый ответ уже за пределом ожидания телефона.
  for (let i = 0; i < 16; i += 1) metrics.recordStage('tail_many', 1_500);
  for (let i = 0; i < 4; i += 1) metrics.recordStage('tail_many', 60_000);

  const s = metrics.snapshot().stage_ms['tail_many']!;
  assert.ok(s.avg < 15_000, `среднее всё ещё не тревожит: ${s.avg} ms`);
  assert.ok(s.p95 >= 50_000, `а p95 обязан выдать хвост, получено ${s.p95} ms`);
});

test('p95 — это ВЕРХНЯЯ граница корзины, а не интерполяция', () => {
  for (let i = 0; i < 10; i += 1) metrics.recordStage('edge_probe', 2_500);
  const s = metrics.snapshot().stage_ms['edge_probe']!;
  // 2500 мс лежит в корзине (2000, 3000] — честный ответ «уложились в 3 с».
  assert.equal(s.p95, 3_000);
  assert.equal(s.max, 2_500);
});

test('пустой счётчик не выдумывает перцентиль', () => {
  const s = metrics.snapshot().latency_ms.workout_photo!;
  if (s.count === 0) {
    assert.equal(s.p95, 0);
    assert.equal(s.max, 0);
  }
});

test('recordAbandoned считает брошенные клиентом запросы по маршрутам', () => {
  const before = metrics.snapshot().abandoned['photo'] ?? 0;
  metrics.recordAbandoned('photo');
  metrics.recordAbandoned('photo');
  metrics.recordAbandoned('text');
  const after = metrics.snapshot();
  assert.equal(after.abandoned['photo'], before + 2);
  assert.equal(after.abandoned['text'], 1);
});

/**
 * Счётчик отвечает на вопрос «доезжает ли обязательное поле», поэтому считать
 * он обязан ОБЕ стороны: только доли present/total различают «модель молчит»
 * и «этот маршрут просто мало ходили».
 */
test('recordSchemaField копит и приходы, и общее число', () => {
  metrics.recordSchemaField('identify_text', 'weight_basis', true);
  metrics.recordSchemaField('identify_text', 'weight_basis', false);
  metrics.recordSchemaField('identify_text', 'weight_basis', false);
  const s = metrics.snapshot().schema_fields['identify_text.weight_basis']!;
  assert.equal(s.total, 3);
  assert.equal(s.present, 1);
});

test('recordUsage складывает токены по вызову и модели', () => {
  metrics.recordUsage('identify_photo|test-model', 900, 300);
  metrics.recordUsage('identify_photo|test-model', 850, 6_000);
  const t = metrics.snapshot().tokens['identify_photo|test-model']!;
  assert.equal(t.calls, 2);
  assert.equal(t.prompt, 1_750);
  // Тридцатикратный разброс на выходе — причина, по которой счётчик вызовов
  // ничего не говорит о цене.
  assert.equal(t.completion, 6_300);
});

test('польза эскалации считается отдельно от попытки', () => {
  const before = metrics.snapshot();
  metrics.recordEscalation();
  metrics.recordEscalation();
  metrics.recordEscalationBetter();
  const after = metrics.snapshot();
  assert.equal(after.escalations, before.escalations + 2);
  assert.equal(after.escalations_better, before.escalations_better + 1);
});
