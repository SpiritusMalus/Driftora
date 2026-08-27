import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  contradictsQuery,
  contradictsSugarFree,
  demoteContradictions,
  genericBonus,
  isSugarFreeQuery,
  normalizeName,
  rankByName,
  MIN_CHAIN_COVERAGE,
  queryCoverage,
  scoreName,
  scoreToConfidence,
} from '../src/nutrition/scoring.js';

test('normalizeName: lowercases, folds ё, strips punctuation', () => {
  assert.equal(normalizeName('Гречка, отварная!'), 'гречка отварная');
  assert.equal(normalizeName('Тёмный  шоколад'), 'темный шоколад');
});

test('scoreName: exact = 1, disjoint = 0, partial in between', () => {
  assert.equal(scoreName('рис', 'рис'), 1);
  assert.equal(scoreName('рис', 'банан'), 0);
  assert.ok(scoreName('куриная грудка', 'куриная грудка отварная') > 0.5);
  // candidate contains the whole query → substring bonus.
  assert.ok(scoreName('рис', 'рис басмати') >= 0.2);
});

test('genericBonus: generic up, brand down, unknown neutral', () => {
  assert.ok(genericBonus('Generic') > 0);
  assert.ok(genericBonus('Brand') < 0);
  assert.equal(genericBonus(undefined), 0);
});

test('rankByName: generic plain food beats a closer-typed brand', () => {
  const ranked = rankByName('творог', [
    { value: 'a', name: 'Творог Activia', foodType: 'Brand' },
    { value: 'b', name: 'Творог', foodType: 'Generic' },
  ]);
  assert.equal(ranked[0]?.value, 'b'); // generic exact match wins
  assert.ok(ranked[0]!.score > ranked[1]!.score);
});

test('rankByName: genericBonus never rescues a zero-name-overlap row (salad→milk)', () => {
  // FatSecret returns a "Generic" milk row for a salad query. The +0.1 generic
  // bonus must NOT lift its zero name score above 0 — otherwise it floors to
  // 0.4 confidence and survives the resolver's junk filter.
  const ranked = rankByName('овощной салат с пекинской капустой и помидорами', [
    { value: 'milk', name: '1% Fat Milk (Calcium Fortified)', foodType: 'Generic' },
  ]);
  assert.equal(ranked[0]?.score, 0);
  assert.equal(scoreToConfidence(ranked[0]!.score), 0); // → filtered out as junk
});

test('scoreToConfidence: real-but-terse hit floored at 0.4, but zero overlap → 0', () => {
  assert.equal(scoreToConfidence(0), 0); // nothing in common is NOT a match (milk vs salad)
  assert.equal(scoreToConfidence(0.1), 0.4); // a real, weak overlap is floored so it doesn't read as junk
  assert.equal(scoreToConfidence(1), 1);
  assert.ok(scoreToConfidence(0.7) > 0.4);
});

// ---- sugar-negation contradiction (the «энергетик без сахара» → Arctic bug) --

test('isSugarFreeQuery: RU and EN markers, Cyrillic without \\b', () => {
  assert.equal(isSugarFreeQuery('энергетический напиток без сахара'), true);
  assert.equal(isSugarFreeQuery('sugar-free energy drink'), true);
  assert.equal(isSugarFreeQuery('кола зеро'), true);
  assert.equal(isSugarFreeQuery('диетическая кола'), true);
  assert.equal(isSugarFreeQuery('энергетический напиток адреналин раш'), false);
  assert.equal(isSugarFreeQuery('сахар'), false); // sugar itself is not a negation
});

test('contradictsSugarFree: explicit sugar wins over the carb fallback', () => {
  assert.equal(contradictsSugarFree({ sugar: 11.2, carb: 11.6 }), true);
  assert.equal(contradictsSugarFree({ sugar: 0, carb: 0.4 }), false);
  // Sugar-free cookies: carbs are flour, explicit sugar is low → NOT a contradiction.
  assert.equal(contradictsSugarFree({ sugar: 0.5, carb: 60 }), false);
  // No sugar field at all: high-carb row reads as sugared for a drink-like query.
  assert.equal(contradictsSugarFree({ carb: 11.6 }), true);
  assert.equal(contradictsSugarFree({ carb: 0.3 }), false);
});

test('demoteContradictions: a close-named clean row floats up, contradictions capped below 0.5', () => {
  const sugared = { per100: { sugar: 11.2, carb: 11.6 }, confidence: 0.9, name: 'Arctic' };
  const zero = { per100: { sugar: 0, carb: 0.4 }, confidence: 0.75, name: 'Zero' };
  const out = demoteContradictions('энергетик без сахара', [sugared, zero]);
  assert.equal(out[0]!.name, 'Zero'); // composition beats name score
  assert.equal(out[1]!.name, 'Arctic');
  assert.ok(out[1]!.confidence <= 0.4); // flagged low → client opens «не то?»
  // Without a negation in the query nothing moves.
  const same = demoteContradictions('энергетик', [sugared, zero]);
  assert.equal(same[0]!.name, 'Arctic');
  assert.equal(same[0]!.confidence, 0.9);
});

test('demoteContradictions: an unrelated clean row is NOT promoted over the head', () => {
  const sugared = { per100: { sugar: 11.2, carb: 11.6 }, confidence: 0.67, name: 'Напиток энергетический Arctic' };
  // OFF floors weak name matches at exactly 0.4 — the real live value.
  const candy = { per100: { sugar: 0.4, carb: 9 }, confidence: 0.4, name: 'Конфеты без сахара с фундуком' };
  const out = demoteContradictions('энергетический напиток без сахара', [sugared, candy]);
  // 391-kcal candy must not become the primary for an energy-drink query —
  // the sugared head stays on top, honestly flagged low-confidence.
  assert.equal(out[0]!.name, 'Напиток энергетический Arctic');
  assert.ok(out[0]!.confidence <= 0.4);
  assert.equal(out[1]!.name, 'Конфеты без сахара с фундуком');
});

// ---- cooking-method contradiction (the «отварное» → «в панировке» bug) ------

test('demoteContradictions: breaded row demoted on a boiled query, RU and EN', () => {
  // Owner report 2026-08-25: photo identified «куриное филе отварное», the DB
  // served «Куриное филе в панировке» — 252 kcal/100 g instead of ~150.
  const breaded = { per100: { carb: 17.6 }, confidence: 0.9, name: 'Куриное филе в панировке' };
  const boiled = { per100: { carb: 0 }, confidence: 0.75, name: 'Куриное филе отварное' };
  const out = demoteContradictions('куриное филе отварное', [breaded, boiled]);
  assert.equal(out[0]!.name, 'Куриное филе отварное'); // consistent method beats name score
  assert.ok(out[1]!.confidence <= 0.4); // breaded row flagged low → picker opens

  // Same on the English side (USDA is queried with name_en).
  const en = demoteContradictions('boiled chicken fillet', [
    { per100: { carb: 17.6 }, confidence: 0.9, name: 'Chicken breast fillet, breaded, cooked' },
    { per100: { carb: 0 }, confidence: 0.75, name: 'Chicken, broilers or fryers, breast, meat only, cooked, stewed' },
  ]);
  assert.ok(en[0]!.name!.includes('stewed')); // stewed = same moist group as boiled
  assert.ok(en[1]!.confidence <= 0.4);
});

test('demoteContradictions: method demotion works in the fried→boiled direction too', () => {
  const out = demoteContradictions('картофель жареный', [
    { per100: { carb: 17 }, confidence: 0.9, name: 'картофель отварной' },
    { per100: { carb: 23 }, confidence: 0.7, name: 'картофель жареный' },
  ]);
  assert.equal(out[0]!.name, 'картофель жареный');
  assert.ok(out[1]!.confidence <= 0.4);
});

test('demoteContradictions: no method in the query, or no added-fat gap → nothing moves', () => {
  const breaded = { per100: { carb: 17.6 }, confidence: 0.9, name: 'Куриное филе в панировке' };
  const plain = { per100: { carb: 0 }, confidence: 0.75, name: 'Куриное филе' };
  // Query names no method — the user did not rule anything out.
  const same = demoteContradictions('куриное филе', [breaded, plain]);
  assert.equal(same[0]!.name, 'Куриное филе в панировке');
  assert.equal(same[0]!.confidence, 0.9);
  // Moist vs dry heat is a rounding error, not a contradiction: USDA's
  // canonical plain rows say «cooked, roasted» and must survive «отварное».
  const roasted = demoteContradictions('boiled chicken fillet', [
    { per100: { carb: 0 }, confidence: 0.9, name: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted' },
  ]);
  assert.equal(roasted[0]!.confidence, 0.9);
  // A row with no method word at all is consistent with any query.
  const bare = demoteContradictions('куриное филе отварное', [plain]);
  assert.equal(bare[0]!.confidence, 0.75);
});

test('demoteContradictions: look-alike words are not methods (печень, варенье, fryers)', () => {
  // «печень» is liver, not «печёный»; «варенье» is jam, not «варёный»;
  // «вареники» ARE boiled — same moist group, consistent.
  const liver = demoteContradictions('треска отварная', [
    { per100: { carb: 1.2 }, confidence: 0.8, name: 'печень трески' },
  ]);
  assert.equal(liver[0]!.confidence, 0.8);
  const jam = demoteContradictions('картофель отварной', [
    { per100: { carb: 70 }, confidence: 0.8, name: 'варенье малиновое' },
  ]);
  assert.equal(jam[0]!.confidence, 0.8);
  const vareniki = demoteContradictions('картофель отварной', [
    { per100: { carb: 18 }, confidence: 0.8, name: 'вареники с картофелем' },
  ]);
  assert.equal(vareniki[0]!.confidence, 0.8);
  // «broilers or fryers» is a breed phrase, not frying.
  const breed = demoteContradictions('boiled chicken breast', [
    { per100: { carb: 0 }, confidence: 0.8, name: 'Chicken, broilers or fryers, breast, meat only, cooked, stewed' },
  ]);
  assert.equal(breed[0]!.confidence, 0.8);
});

test('queryCoverage: unmatched query words count against the match', () => {
  // The lemonade bug: one shared token of three. Jaccard flatters it (0.25 →
  // floored to a respectable 0.4 confidence); coverage stays honest at 1/3.
  assert.ok(Math.abs(queryCoverage('tarragon soda chernogolovka', 'Tarragon, dried') - 1 / 3) < 1e-9);
  assert.ok(queryCoverage('tarragon soda chernogolovka', 'Tarragon, dried') < MIN_CHAIN_COVERAGE);
  // A real match explains what was asked for.
  assert.equal(queryCoverage('chicken breast', 'Chicken, breast, raw'), 1);
  // A qualifier the DB omits costs a token but stays above the bar.
  assert.ok(queryCoverage('куриная грудка варёная', 'куриная грудка') >= MIN_CHAIN_COVERAGE);
  assert.equal(queryCoverage('', 'anything'), 0);
  assert.equal(queryCoverage('anything', ''), 0);
});

test('queryCoverage: an inflected form is covered — the gate matches at the tolerance that found the row', () => {
  // Раньше здесь было равенство строк, и таблица теряла ЛЮБУЮ словоформу,
  // которую человек реально печатает: «помидоры» против строки «помидор» давали
  // 0.00 при том, что RU-матчер только что оценил их в 0.85. Строка уходила в
  // запасные, обход продолжался, и выигрывала брендовая строка, в НАЗВАНИИ
  // которой словоформа совпала буквально: «огурцы» → «Тёща огурцы бочковые».
  assert.equal(queryCoverage('помидоры', 'помидор'), 1);
  assert.equal(queryCoverage('огурцы', 'огурец'), 1);
  assert.ok(queryCoverage('салат айсберг', 'салат айсберг') >= MIN_CHAIN_COVERAGE);

  // Терпимость не должна стать всеядностью: чужая еда по-прежнему не покрыта.
  assert.equal(queryCoverage('огурцы', 'помидор'), 0);
  assert.ok(queryCoverage('борщ', 'молоко') < MIN_CHAIN_COVERAGE);
});

test('без сахара: строка, сама заявляющая «без сахара», не демотируется углеводной эвристикой', () => {
  // Углеводный порог калиброван под напитки и врёт о твёрдой еде: «печенье без
  // сахара» несёт 40–60 г углеводов из муки и полиолов ЗАКОННО. FatSecret и
  // RU-таблицы не несут поля «сахар» вовсе — до фикса их sugar-free строки
  // демотировались собственными углеводами (аудит 2026-08-26).
  assert.equal(
    contradictsQuery('печенье без сахара', {
      name: 'Печенье Без Сахара',
      per100: { carb: 58 },
    }),
    false,
  );
  // Явное поле сахара сильнее имени: подписанная «без сахара» строка с 8 г
  // сахара — противоречие, как и раньше.
  assert.equal(
    contradictsQuery('печенье без сахара', {
      name: 'Печенье без сахара',
      per100: { sugar: 8, carb: 58 },
    }),
    true,
  );
  // Родовая строка без поля сахара и без заявления в имени — по-прежнему
  // противоречие: обычное печенье и правда с сахаром.
  assert.equal(
    contradictsQuery('печенье без сахара', { name: 'Печенье овсяное', per100: { carb: 58 } }),
    true,
  );
});
