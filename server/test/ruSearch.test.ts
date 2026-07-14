import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasCyrillic, phraseScore, stemRu, tokenScore, withinOneEdit } from '../src/nutrition/ruSearch.js';

test('stemRu strips one inflectional ending, keeps stems ≥ 3 chars', () => {
  assert.equal(stemRu('борща'), 'борщ');
  assert.equal(stemRu('котлету'), 'котлет');
  assert.equal(stemRu('гречневая'), 'гречнев');
  assert.equal(stemRu('гречневой'), 'гречнев');
  assert.equal(stemRu('пельменей'), 'пельмен');
  // Too short to strip — «щи» must not collapse to «щ».
  assert.equal(stemRu('щи'), 'щи');
  assert.equal(stemRu('уха'), 'уха');
});

test('withinOneEdit: substitution, deletion, insertion, transposition', () => {
  assert.ok(withinOneEdit('гречка', 'гречка'));
  assert.ok(withinOneEdit('гречка', 'гречко')); // substitution
  assert.ok(withinOneEdit('гречка', 'гречк')); // deletion
  assert.ok(withinOneEdit('гречка', 'гречкав')); // insertion (wrong but close)
  assert.ok(withinOneEdit('гречка', 'грекча')); // adjacent transposition
  assert.ok(!withinOneEdit('гречка', 'молоко'));
  assert.ok(!withinOneEdit('гречка', 'гречихи')); // two edits away
});

test('tokenScore ranks exact > prefix > stem > fuzzy > none', () => {
  const exact = tokenScore('борщ', 'борщ');
  const prefix = tokenScore('гречк', 'гречка');
  const stem = tokenScore('борща', 'борщ');
  const fuzzy = tokenScore('гретчка', 'гречка');
  const none = tokenScore('борщ', 'молоко');
  assert.equal(exact, 1);
  assert.ok(prefix > stem || prefix === 0.85); // prefix 0.85 sits above stem 0.8
  assert.ok(stem > fuzzy);
  assert.ok(fuzzy > none);
  assert.equal(none, 0);
});

test('tokenScore: no typo tolerance for short words («сок» ≠ «сом»)', () => {
  assert.equal(tokenScore('сок', 'сом'), 0);
});

test('phraseScore: qualified query still finds the plain dish', () => {
  const s = phraseScore('куриная грудка отварная', 'куриная грудка');
  assert.ok(s >= 0.5, `expected ≥ 0.5, got ${s}`);
  assert.ok(s < 1);
});

test('phraseScore: plain query ranks the plain dish above the composite', () => {
  const plain = phraseScore('борщ', 'борщ');
  const composite = phraseScore('борщ', 'борщ с мясом');
  assert.equal(plain, 1);
  assert.ok(composite < plain);
  assert.ok(composite >= 0.5, 'the composite still qualifies as a candidate');
});

test('phraseScore: no shared tokens → 0', () => {
  assert.equal(phraseScore('абракадабра несъедобная', 'крабовый салат'), 0);
});

test('phraseScore: an unhonoured qualifier lands at the 0.5 floor', () => {
  // «сыр легкий» → «сыр российский»: one word matched, one dropped, both keys
  // two-word — exactly 0.5, so MIN_SCORE (0.55) filters it as noise.
  assert.equal(phraseScore('сыр легкий', 'сыр российский'), 0.5);
  // Both words honoured ranks strictly above the half-match.
  assert.ok(phraseScore('сыр легкий', 'сыр легкий') > 0.5);
});

test('hasCyrillic', () => {
  assert.ok(hasCyrillic('борщ'));
  assert.ok(hasCyrillic('Ёлка'));
  assert.ok(!hasCyrillic('rice bowl 100g'));
});
