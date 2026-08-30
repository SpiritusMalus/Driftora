import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RESPONSE_BUDGET_MS, withinBudget } from '../src/httpTimeout.js';

/**
 * У ЗАПРОСА ОДИН БЮДЖЕТ. Стадии ограничены каждая своим таймаутом, но их сумма
 * не ограничена ничем — поиск успевал сложить 44 с там, где телефон ждёт 25 с,
 * и человек получал заглушку «нет сети» поверх посчитанного ответа.
 */

test('успевшая работа отдаёт свой результат', async () => {
  const out = await withinBudget(Date.now(), 1000, async () => 'перевод', 'английский');
  assert.equal(out, 'перевод');
});

test('не успевшая — отдаёт запасной вариант, ответ не ждёт её', async () => {
  const started = Date.now();
  const out = await withinBudget(
    started,
    30,
    () => new Promise<string>((resolve) => setTimeout(() => resolve('перевод'), 500)),
    'английский',
  );
  assert.equal(out, 'английский');
  assert.ok(Date.now() - started < 300, 'ответ не должен ждать опоздавшую стадию');
});

test('бюджет, потраченный до вызова, не даёт даже начать', async () => {
  let started = false;
  const out = await withinBudget(
    Date.now() - 5000,
    1000,
    async () => {
      started = true;
      return 'перевод';
    },
    'английский',
  );
  assert.equal(out, 'английский');
  assert.equal(started, false); // платить за то, чего никто не дождётся, незачем
});

test('упавшая работа не роняет ответ', async () => {
  const out = await withinBudget(
    Date.now(),
    1000,
    async () => {
      throw new Error('перевод лёг');
    },
    'английский',
  );
  assert.equal(out, 'английский');
});

test('бюджет ответа заведомо меньше того, что ждёт клиент', () => {
  // Клиентские потолки: текст 25 с, загрузка 50 с (httpFoodParser.ts).
  assert.ok(RESPONSE_BUDGET_MS.text < 25_000);
  assert.ok(RESPONSE_BUDGET_MS.upload < 50_000);
});
