import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ESTIMATE_SEARCH_SCHEMA,
  IDENTIFY_AUDIO_SCHEMA,
  IDENTIFY_PHOTO_SCHEMA,
  IDENTIFY_PHOTO_SYSTEM_PROMPT,
  IDENTIFY_SCHEMA,
  IDENTIFY_SYSTEM_PROMPT,
  IDENTIFY_TEXT_SCHEMA,
  PARSE_WORKOUT_PHOTO_SCHEMA,
  PARSE_WORKOUT_SCHEMA,
  PARSE_WORKOUT_SYSTEM_PROMPT,
  READ_LABEL_SCHEMA,
  TRANSLATE_LABELS_SCHEMA,
} from '../src/prompt.js';

/**
 * Contract pins from the 2026-08-26 prompt audit. These are deliberate,
 * owner-ordered decisions — a refactor must not silently regress them.
 */

test('audio schema REQUIRES heard — the tester\'s «текст должен быть» is enforced, not requested', () => {
  assert.ok((IDENTIFY_AUDIO_SCHEMA.required as readonly string[]).includes('heard'));
  assert.ok((IDENTIFY_AUDIO_SCHEMA.required as readonly string[]).includes('items'));
});

test('audio prompt keeps brands and grades — voice is the owner\'s primary input mode', () => {
  // Without this rule the model normalized «творог 5%» to «творог» and the
  // whole specificity chain went blind on voice notes.
  assert.ok(IDENTIFY_SYSTEM_PROMPT.includes('KEEP brand and grade words'));
});

test('photo contract stays free of nutrition numbers (the decode loop lived there)', () => {
  const props = IDENTIFY_PHOTO_SCHEMA.properties.items.items.properties as Record<string, unknown>;
  assert.equal('estimate' in props, false, 'no per-100g block in the photo schema');
  assert.equal('label' in props, false, 'label reading is its own dedicated pass');
  // The anti-anchoring portion rule and the water rule are prompt-text only.
  assert.ok(IDENTIFY_PHOTO_SYSTEM_PROMPT.includes('VISIBLE volume'));
  assert.ok(IDENTIFY_PHOTO_SYSTEM_PROMPT.includes('Ignore plain water'));
});

test('fiber is asked for where it can be honest: the estimator and the label pass', () => {
  assert.ok('fiber_100g' in ESTIMATE_SEARCH_SCHEMA.properties);
  // …but stays OPTIONAL: a fiberless answer must remain a valid card.
  assert.equal((ESTIMATE_SEARCH_SCHEMA.required as readonly string[]).includes('fiber_100g'), false);
  assert.ok('fiber_100g' in READ_LABEL_SCHEMA.properties.label.properties);
});

test('workout prompt refuses bare step counts — the phone already counts steps', () => {
  assert.ok(PARSE_WORKOUT_SYSTEM_PROMPT.includes('STEP COUNT'));
});

/**
 * ТРЕБОВАТЬ МОЖНО ТОЛЬКО ТО, ЧТО ОБЪЯВЛЕНО.
 *
 * `IDENTIFY_TEXT_SCHEMA` называла `weight_basis` обязательным, ни разу его не
 * описав: единственная из восьми схем файла с таким расхождением, и ровно на
 * самом ходовом маршруте. Такую схему не ловит ни один существующий тест —
 * оба списка выглядят правдоподобно по отдельности, а сверить их было некому.
 *
 * Расхождение стоит дважды. Модели не из чего построить ответ: имени поля без
 * типа и без enum в контракте попросту нет. И в строгом режиме (`strict: true`,
 * куда эта служба, вероятно, поедет) ключ из `required`, отсутствующий в
 * `properties`, делает всю схему невалидной — то есть одна забытая строка
 * блокирует переход, ради которого его затевают.
 *
 * Обход рекурсивный: вложенные объекты (`items.items`, `label`, `estimate`)
 * ошибаются ровно так же, как верхний уровень.
 */
type SchemaNode = { type?: unknown; properties?: Record<string, unknown>; required?: readonly string[]; items?: unknown };

function eachObjectNode(node: unknown, path: string, visit: (n: SchemaNode, path: string) => void): void {
  if (!node || typeof node !== 'object') return;
  const n = node as SchemaNode;
  if (n.properties || n.required) visit(n, path);
  if (n.properties) {
    for (const [key, child] of Object.entries(n.properties)) eachObjectNode(child, `${path}.${key}`, visit);
  }
  if (n.items) eachObjectNode(n.items, `${path}[]`, visit);
}

const ALL_SCHEMAS: readonly [string, unknown][] = [
  ['IDENTIFY_SCHEMA', IDENTIFY_SCHEMA],
  ['IDENTIFY_TEXT_SCHEMA', IDENTIFY_TEXT_SCHEMA],
  ['IDENTIFY_PHOTO_SCHEMA', IDENTIFY_PHOTO_SCHEMA],
  ['IDENTIFY_AUDIO_SCHEMA', IDENTIFY_AUDIO_SCHEMA],
  ['ESTIMATE_SEARCH_SCHEMA', ESTIMATE_SEARCH_SCHEMA],
  ['TRANSLATE_LABELS_SCHEMA', TRANSLATE_LABELS_SCHEMA],
  ['READ_LABEL_SCHEMA', READ_LABEL_SCHEMA],
  ['PARSE_WORKOUT_SCHEMA', PARSE_WORKOUT_SCHEMA],
  ['PARSE_WORKOUT_PHOTO_SCHEMA', PARSE_WORKOUT_PHOTO_SCHEMA],
];

test('каждое обязательное поле каждой схемы объявлено в properties', () => {
  const broken: string[] = [];
  for (const [name, schema] of ALL_SCHEMAS) {
    eachObjectNode(schema, name, (node, path) => {
      for (const field of node.required ?? []) {
        if (!node.properties || !(field in node.properties)) broken.push(`${path}.${field}`);
      }
    });
  }
  assert.deepEqual(broken, [], 'required без properties: модели нечего вернуть, а strict-режим отвергнет схему');
});

test('обход действительно спускается внутрь — иначе тест выше зелен по недосмотру', () => {
  // Страховка от самого правдоподобного отказа проверки: она молча ничего не
  // обошла бы, и «нарушений нет» означало бы «я не смотрел».
  const seen: string[] = [];
  eachObjectNode(IDENTIFY_TEXT_SCHEMA, 'root', (_n, path) => seen.push(path));
  assert.ok(seen.includes('root.items[]'), `вложенный узел не посещён: ${seen.join(', ')}`);
});

test('текстовый контракт называет базис веса — сторона пары, которую знает только наблюдатель', () => {
  // Регресс #227: без объявленного поля сервер остаётся с узкой эвристикой
  // `weighedDry` на семь крахмалов, а «доширак 90 г» занижается втрое.
  const props = IDENTIFY_TEXT_SCHEMA.properties.items.items.properties as Record<string, unknown>;
  assert.ok('weight_basis' in props);
  assert.deepEqual(
    (props.weight_basis as { enum?: readonly string[] }).enum,
    ['dry', 'as_eaten'],
    'значения должны совпадать с фото- и аудио-контрактом — резолвер сверяет их дословно',
  );
});
