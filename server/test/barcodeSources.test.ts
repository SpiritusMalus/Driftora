import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Resolver } from '../src/nutrition/resolver.js';
import { ProviderUnavailable, type NutritionProvider, type ProviderResult } from '../src/nutrition/provider.js';

/// Таблица ИМЁН: цифрам сопоставить нечего, и на штрихкоде она падает.
/// Именно так ведёт себя USDA, когда ей приносят код с упаковки.
class NameOnlySource implements NutritionProvider {
  readonly name = 'usda';
  readonly regions = ['RU', 'US'] as const;
  asked: string[] = [];
  // Аннотация обязательна: тело только бросает, и TS выводит Promise<void>,
  // который контракту провайдера не соответствует.
  async search(name: string): Promise<ProviderResult | null> {
    this.asked.push(name);
    throw new ProviderUnavailable(this.name, 429);
  }
}

/// Open Food Facts: для неё код — родной ключ. Товара нет — это честный 404,
/// то есть ПУСТО, а не «источник недоступен».
class BarcodeSource implements NutritionProvider {
  readonly name = 'openfoodfacts';
  readonly regions = ['RU', 'US'] as const;
  readonly acceptsBarcode = true as const;
  asked: string[] = [];
  async search(name: string): Promise<ProviderResult | null> {
    this.asked.push(name);
    return null;
  }
}

test('неизвестный штрихкод — это «нет такого товара», а не «источник не ответил»', async () => {
  const names = new NameOnlySource();
  const codes = new BarcodeSource();
  const resolver = new Resolver([names, codes]);

  const found = await resolver.search('4680981520030', 'RU');

  assert.equal(found.candidates.length, 0);
  assert.equal(
    found.sourcesDown,
    false,
    'иначе телефон предлагает повторить попытку, которая не может удаться',
  );
  assert.deepEqual(names.asked, [], 'таблицу имён по коду не спрашиваем вовсе');
  assert.deepEqual(codes.asked, ['4680981520030'], 'а базу штрихкодов — спрашиваем');
});

test('настоящий сбой базы штрихкодов по-прежнему виден', async () => {
  class DownSource extends BarcodeSource {
    override async search(name: string): Promise<ProviderResult | null> {
      this.asked.push(name);
      throw new ProviderUnavailable(this.name, 503);
    }
  }
  const codes = new DownSource();
  const resolver = new Resolver([new NameOnlySource(), codes]);

  const found = await resolver.search('4680981520030', 'RU');

  assert.equal(found.sourcesDown, true, 'здесь повтор ИМЕЕТ смысл — и это надо сказать');
});

test('обычный текстовый запрос таблицу имён не теряет', async () => {
  const names = new NameOnlySource();
  const resolver = new Resolver([names, new BarcodeSource()]);

  await resolver.search('chicken breast', 'US');

  assert.deepEqual(names.asked, ['chicken breast'], 'пропуск касается ТОЛЬКО штрихкодов');
});
