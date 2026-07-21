import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

const { buildPayload } = await import('../src/llm.js');

test('buildPayload: reasoning effort rides along when set, absent when off/unset', () => {
  const messages = [{ role: 'user' as const, content: 'борщ' }];

  const withLow = buildPayload(messages, 'model', {}, 0, 'low') as { reasoning?: { effort?: string } };
  assert.deepEqual(withLow.reasoning, { effort: 'low' });

  // 'off' must omit the field entirely — providers keep their own defaults.
  const off = buildPayload(messages, 'model', {}, 0, 'off') as { reasoning?: unknown };
  assert.equal(off.reasoning, undefined);

  const unset = buildPayload(messages, 'model') as { reasoning?: unknown };
  assert.equal(unset.reasoning, undefined);
});
