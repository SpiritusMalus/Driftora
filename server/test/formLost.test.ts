import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NutritionProvider } from '../src/nutrition/provider.js';
import { Resolver } from '../src/nutrition/resolver.js';
import { dropsForm, introducesForeignForm } from '../src/nutrition/scoring.js';
import { SkurikhinProvider } from '../src/nutrition/skurikhin.js';

// ─── «форма потеряна»: запрос назвал форму, строка её не несёт ───────────────
// Скрин владельца 2026-09-03: «глазированный сырок» → name_en «glazed cottage
// cheese bar» → FatSecret «Творог» 87 ккал/100 г. Все слова, кроме формы, на
// месте; покрытие ровно 0.5 проходило порог; headNounLost по английской паре
// из четырёх слов молчит. Сырок в шоколаде приезжал творогом.

test('dropsForm: строка без формы, которую назвал запрос', () => {
  assert.equal(dropsForm('glazed cottage cheese bar', 'Творог'), true, 'сырок → творог');
  assert.equal(dropsForm('glazed cottage cheese bar', 'Cottage Cheese'), true);
  assert.equal(dropsForm('protein bar', 'Protein Powder'), true);
  assert.equal(dropsForm('granola bar', 'Granola'), true);
  assert.equal(dropsForm('pumpkin pie', 'Pumpkin'), true);
  assert.equal(dropsForm('клубника в шоколаде', 'Клубника'), true, 'покрытие — тоже форма');
  assert.equal(dropsForm('сырок глазированный', 'Творог 2%'), true);
  assert.equal(dropsForm('шоколадный торт', 'Chocolate'), true);
});

test('dropsForm: форма на месте — правило молчит', () => {
  assert.equal(dropsForm('chocolate bar', 'Chocolate Bar'), false);
  assert.equal(dropsForm('protein bar', 'Protein Bar, Chocolate'), false);
  assert.equal(dropsForm('сырок глазированный', 'Сырок глазированный'), false);
  assert.equal(dropsForm('глазированный сырок', 'сырок глазированный'), false, 'порядок слов не важен');
  assert.equal(dropsForm('овсяное печенье', 'Печенья овсяные'), false, 'словоформа не важна');
});

test('dropsForm: локализованное имя — та же форма на другом языке', () => {
  // FatSecret с language=ru отдаёт русское имя на английский запрос: «juice» и
  // «сок» — одна форма, иначе каждая локализованная строка теряла бы форму.
  assert.equal(dropsForm('apple juice', 'Сок яблочный'), false);
  assert.equal(dropsForm('ice cream', 'Мороженое пломбир'), false);
  assert.equal(dropsForm('glazed curd bar', 'Сырок глазированный'), false);
  assert.equal(dropsForm('pancakes', 'Блины'), false);
  // …и синонимы локализации, на которых первая версия групп спотыкалась
  // (проверено перебором пар 2026-09-03): та же еда под другим словом.
  assert.equal(dropsForm('pancakes', 'Оладьи'), false);
  assert.equal(dropsForm('cottage cheese pancakes', 'Сырники'), false, 'сырники — те же оладьи');
  assert.equal(dropsForm('cheesecake', 'Чизкейк'), false);
  assert.equal(dropsForm('cupcake', 'Кекс'), false);
  assert.equal(dropsForm('muffin', 'Маффин'), false);
  assert.equal(dropsForm('biscuit', 'Бисквит'), false);
  assert.equal(dropsForm('ice cream', 'Пломбир'), false);
  assert.equal(dropsForm('orange juice', 'Апельсиновый нектар'), false);
  assert.equal(dropsForm('candy', 'Леденцы'), false);
  assert.equal(dropsForm('potato pancakes', 'Драники'), false);
  assert.equal(dropsForm('crackers', 'Галеты'), false);
});

test('dropsForm: «chocolate bar» — по-русски просто шоколад, формы тут нет', () => {
  // Локализация теряет «bar», еда та же: плитка шоколада — шоколад. Ни
  // FatSecret-строка «Шоколад молочный», ни строка RU-таблицы не должны
  // демотироваться ради слова, которого в русском названии не бывает.
  assert.equal(dropsForm('chocolate bar', 'Шоколад молочный'), false);
  assert.equal(dropsForm('плитка шоколада', 'шоколад молочный'), false);
  assert.equal(dropsForm('milk chocolate bar', 'Chocolate, milk'), false);
  // А батончик — форма: протеиновый батончик не порошок, гранола не батончик.
  assert.equal(dropsForm('protein bar', 'Протеин'), true);
  assert.equal(dropsForm('granola bar', 'Гранола'), true);
});

test('dropsForm: хоть одна из названных форм есть — не чужая', () => {
  assert.equal(dropsForm('cookie dough ice cream', 'Ice Cream, Vanilla'), false);
});

test('dropsForm: запрос без формы правило не трогает', () => {
  assert.equal(dropsForm('oatmeal', 'Oatmeal Raisin Cookies'), false, 'это другая сторона — introducesForeignForm');
  assert.equal(dropsForm('творог', 'Творог 2%'), false);
  assert.equal(dropsForm('куриная грудка', 'Курица'), false);
  assert.equal(dropsForm('', 'Творог'), false);
  assert.equal(dropsForm('bar', ''), false);
});

test('сырок — только целое слово: сырокопчёная — не сырок, сырники — своя форма', () => {
  // «сырокопчёная» начинается так же, но сырком не является.
  assert.equal(dropsForm('сырокопчёная колбаса', 'Колбаса'), false);
  assert.equal(introducesForeignForm('колбаса', 'Колбаса сырокопчёная'), false);
  assert.equal(dropsForm('два сырка', 'Творог'), true);
  assert.equal(introducesForeignForm('творог', 'Сырок глазированный'), true, 'сырок на запрос «творог» — чужая форма');
  // Сырники — не сырок, а оладьи (своя группа): творог для них — чужая строка,
  // а строка «Сырники» на запрос «cottage cheese pancakes» — та же форма.
  assert.equal(dropsForm('сырники', 'Сырники домашние'), false);
  assert.equal(dropsForm('сырники', 'Творог'), true, 'сырники на творог — потеря формы');
  assert.equal(introducesForeignForm('творог', 'Сырники'), true);
});

test('покрытие — форма ТОЛЬКО в сторону потери: глазированный пончик — всё ещё пончик', () => {
  assert.equal(introducesForeignForm('donut', 'Doughnut, glazed'), false);
  assert.equal(introducesForeignForm('пончик', 'Пончик глазированный'), false);
  assert.equal(dropsForm('glazed donut', 'Doughnut, plain'), true, 'а вот потеря глазури — уже другой продукт');
});

// ─── и то же самое на уровне ЦЕПОЧКИ, детерминированно ───────────────────────

function per100(kcal: number, prot: number, fat: number, carb: number) {
  return { kcal, prot, fat, carb };
}

/** Источник, отвечающий одной строкой на любой запрос. */
function stub(name: string, rowName: string, row: ReturnType<typeof per100>, queryLang?: 'en' | 'ru'): NutritionProvider {
  return {
    name,
    regions: ['RU', 'US'] as const,
    ...(queryLang ? { queryLang } : {}),
    async search() {
      return { name: rowName, per100: row, confidence: 0.8 };
    },
  } as unknown as NutritionProvider;
}

const glazedBar = {
  name_ru: 'глазированный сырок',
  name_en: 'glazed cottage cheese bar',
  est_grams: 45,
  confidence: 0.8,
};

test('цепочка: строка, потерявшая форму, не останавливает обход', async () => {
  // Ровно боевой ответ 2026-09-03: FatSecret (спрошен по-английски) отдаёт
  // локализованный «Творог» на «glazed cottage cheese bar». Раньше это
  // ОСТАНАВЛИВАЛО цепочку. Теперь обход идёт дальше — до строки, которая несёт
  // форму (у Open Food Facts такие продукты есть).
  const curd = stub('fatsecret', 'Творог', per100(87, 12.9, 2.5, 2.6), 'en');
  const off = stub('openfoodfacts', 'Сырок глазированный в шоколаде', per100(407, 8.5, 27.7, 32));

  const resolved = await new Resolver([curd, off]).resolveItem(glazedBar, 'RU');

  assert.equal(resolved.per100.kcal, 407, 'выиграть должен сырок, а не творог');
  assert.match(resolved.matched_name ?? '', /сырок/i);
});

test('цепочка: когда лучшей строки нет — оценка модели главная, творог лишь вариант', async () => {
  const curd = stub('fatsecret', 'Творог', per100(87, 12.9, 2.5, 2.6), 'en');
  const estimator = async () => ({ name: 'глазированный сырок', kcal: 400, prot: 8, fat: 26, carb: 33 });

  const resolved = await new Resolver([curd], estimator).resolveItem(glazedBar, 'RU');

  assert.equal(resolved.per100.source, 'ai_estimate', 'чужая строка не может пройти как факт');
  assert.equal(resolved.per100.kcal, 400);
  assert.equal(resolved.alternatives?.[0]?.name, 'Творог', 'строка остаётся в один тап');
});

test('цепочка: форма на месте — первый источник останавливает обход, как раньше', async () => {
  // Контроль от перекоса: локализованная строка с той же формой ДОЛЖНА
  // выигрывать сразу, иначе правило гоняло бы цепочку на каждом соке.
  const first = stub('fatsecret', 'Сок яблочный', per100(46, 0.1, 0.1, 11), 'en');
  const second = stub('openfoodfacts', 'Яблоки', per100(52, 0.3, 0.2, 14));

  const resolved = await new Resolver([first, second]).resolveItem(
    { name_ru: 'яблочный сок', name_en: 'apple juice', est_grams: 250, confidence: 0.9 },
    'RU',
  );

  assert.equal(resolved.per100.kcal, 46);
});

// ─── RU-таблица: сырок теперь есть, и он первый в цепочке ────────────────────

test('RU-таблица: «глазированный сырок» — строка Скурихина, не творог', async () => {
  const resolved = await new Resolver([new SkurikhinProvider()]).resolveItem(glazedBar, 'RU');
  assert.equal(resolved.per100.source, 'skurikhin');
  assert.equal(resolved.per100.kcal, 407);
  assert.equal(resolved.matched_name, 'сырок глазированный');
  assert.equal(resolved.prepared, true, 'едят как есть — чипсы способа готовки не нужны');
  // 45 г × 407 ≈ 183 ккал — та самая штука вместо 39.
  assert.equal(resolved.scaled.kcal, 183);
});

test('RU-таблица: сырок без глазури и голый «сырок» тоже находятся', async () => {
  const p = new SkurikhinProvider();
  const plain = await p.search('творожный сырок без глазури', 'RU');
  assert.equal(plain?.per100.kcal, 341);
  // Голое «сырок» двусмысленно (плавленый — сыр, а не творог): обе творожные
  // строки поднимаются по частичному совпадению, выбор — за человеком.
  const bare = await p.searchMany!('сырок', 'RU');
  const names = bare.map((r) => r.name);
  assert.ok(names.includes('сырок глазированный'), names.join(', '));
  assert.ok(names.includes('сырок творожный'), names.join(', '));
});
