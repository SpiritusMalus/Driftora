import { describe, expect, it, jest } from '@jest/globals';

import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';

/**
 * ИДЕНТИФИКАТОР — ПРЕДУСЛОВИЕ ЗАПРОСА. Чеканка id идёт асинхронно при старте
 * БД, а первый разбор мог уйти раньше неё — без `X-Install-Id`, то есть в общую
 * по адресу корзину сервера (на проде это `ip_fallback_active` при нулевых
 * `installs_active`). Заголовок обязан дождаться уже идущей чеканки.
 */
describe('X-Install-Id на запросе', () => {
  const draft = {
    region: 'RU',
    items: [],
    totals: { kcal: 0, prot: 0, fat: 0, carb: 0, minerals: {} },
    portion_state: 'estimated',
    approximate: true,
    flags: { has_estimate: false, has_ai_estimate: false, has_label: false, low_confidence: false },
  };

  function fetchSpy() {
    return jest.fn(async (_url: string, _init?: { headers?: Record<string, string> }) =>
      new Response(JSON.stringify(draft), { status: 200 }),
    );
  }

  it('ждёт чеканку, которая ещё идёт, вместо отправки без заголовка', async () => {
    const spy = fetchSpy();
    global.fetch = spy as unknown as typeof fetch;

    // Чеканка завершится ПОСЛЕ того, как запрос уже начался.
    const minting = new Promise<string>((resolve) => setTimeout(() => resolve('late-install-id-01'), 20));
    const parser = new HttpFoodParser('http://x/food/parse', {
      parse: async () => draft as never,
    } as never, 5000, { installId: () => minting });

    await parser.parse('омлет', 'RU');

    const headers = spy.mock.calls[0]?.[1]?.headers ?? {};
    expect(headers['X-Install-Id']).toBe('late-install-id-01');
  });

  it('без идентификатора запрос всё равно уходит — еда важнее счётчика', async () => {
    const spy = fetchSpy();
    global.fetch = spy as unknown as typeof fetch;

    const parser = new HttpFoodParser('http://x/food/parse', {
      parse: async () => draft as never,
    } as never, 5000, { installId: async () => null });

    await parser.parse('омлет', 'RU');

    const headers = spy.mock.calls[0]?.[1]?.headers ?? {};
    expect(headers['X-Install-Id']).toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});
