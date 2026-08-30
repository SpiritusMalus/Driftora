import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';

const realFetch = globalThis.fetch;

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.USDA_API_KEY = 'test-usda-key';

const { createApp } = await import('../src/app.js');
const { metrics } = await import('../src/metrics.js');

/**
 * КЛИЕНТ ПОЛОЖИЛ ТРУБКУ — И ЭТО НАКОНЕЦ ВИДНО.
 *
 * Единственное звено «сервер перерос ожидание телефона», которое не попадало ни
 * в один счётчик: Express обрыв не замечает, разбор досчитывается и
 * оплачивается, квота уже списана, а `recordParse` пишет УСПЕХ. Здесь обрыв
 * подделан честно — настоящий сокет, настоящий AbortController — и проверены
 * ОБА направления: брошенный запрос считается, доведённый до конца — нет.
 * Второе важнее первого: счётчик, который растёт на успешных ответах, хуже
 * отсутствующего, потому что ему поверят.
 */
function startApp() {
  const server = createApp().listen(0);
  return new Promise<{ base: string; stop: () => Promise<void> }>((resolve) => {
    server.once('listening', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        base: `http://127.0.0.1:${port}`,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** How long the stubbed model takes before answering — the window to hang up in. */
let modelDelayMs = 0;

beforeEach(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('127.0.0.1')) return realFetch(input as never, init);
    if (url.includes('openrouter.ai')) {
      if (modelDelayMs > 0) await new Promise((r) => setTimeout(r, modelDelayMs));
      return json({
        choices: [
          { message: { content: JSON.stringify({ items: [{ name_ru: 'борщ', name_en: 'borsch', est_grams: 300, confidence: 0.9 }] }) } },
        ],
      });
    }
    if (url.includes('api.nal.usda.gov')) {
      const q = new URL(url).searchParams.get('query') ?? 'food';
      return json({ foods: [{ description: q, score: 80, foodNutrients: [{ nutrientNumber: '1008', value: 49 }] }] });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  modelDelayMs = 0;
});

test('брошенный клиентом разбор попадает в abandoned', async () => {
  const { base, stop } = await startApp();
  try {
    modelDelayMs = 400; // сервер ещё работает, когда телефон сдаётся
    const before = metrics.snapshot().abandoned['text'] ?? 0;

    const ctrl = new AbortController();
    const inflight = realFetch(`${base}/food/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'борщ', region: 'RU' }),
      signal: ctrl.signal,
    });
    await new Promise((r) => setTimeout(r, 60));
    ctrl.abort();
    await assert.rejects(inflight, 'запрос должен быть оборван клиентом, а не завершиться');

    // Обрыв доезжает до сервера асинхронно — дать событию 'close' случиться.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(metrics.snapshot().abandoned['text'], before + 1);
  } finally {
    await stop();
  }
});

test('доведённый до конца разбор в abandoned НЕ попадает', async () => {
  const { base, stop } = await startApp();
  try {
    const before = metrics.snapshot().abandoned['text'] ?? 0;

    const res = await realFetch(`${base}/food/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'борщ', region: 'RU' }),
    });
    assert.equal(res.status, 200);
    await res.json();

    // `close` срабатывает и на успешно закрытом ответе — отличает их только
    // `writableEnded`, и именно эта проверка здесь под тестом.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(metrics.snapshot().abandoned['text'] ?? 0, before);
  } finally {
    await stop();
  }
});
