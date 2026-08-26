import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ESTIMATE_SEARCH_SCHEMA,
  IDENTIFY_AUDIO_SCHEMA,
  IDENTIFY_PHOTO_SCHEMA,
  IDENTIFY_PHOTO_SYSTEM_PROMPT,
  IDENTIFY_SYSTEM_PROMPT,
  PARSE_WORKOUT_SYSTEM_PROMPT,
  READ_LABEL_SCHEMA,
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
