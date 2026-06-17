import Anthropic from '@anthropic-ai/sdk';

import { FOOD_TOOL, SYSTEM_PROMPT } from './prompt.js';
import { emptyResult, normalizeResult, type FoodParseResult } from './types.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';

/** The Opus 4.7+/Fable/Mythos family rejects `temperature`; everything else accepts it. */
function supportsTemperature(model: string): boolean {
  return !/^claude-(opus-4-(7|8)|fable|mythos)/.test(model);
}

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

/** Raised when the LLM is unreachable/failing — the route maps it to 503. */
export class ParserUnavailableError extends Error {}

/**
 * Parse a Russian food utterance into a `FoodParseResult` via one forced
 * tool call. Deterministic (temperature 0 where supported), stateless — the
 * utterance is never persisted or logged.
 *
 * Throws `ParserUnavailableError` on an LLM/transport failure. An invalid or
 * missing tool payload is NOT an error: it normalizes to an empty result.
 */
export async function parseFood(utterance: string): Promise<FoodParseResult> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      ...(supportsTemperature(MODEL) ? { temperature: 0 } : {}),
      system: SYSTEM_PROMPT,
      tools: [FOOD_TOOL],
      tool_choice: { type: 'tool', name: FOOD_TOOL.name },
      messages: [{ role: 'user', content: utterance }],
    });
  } catch (err) {
    throw new ParserUnavailableError(
      err instanceof Error ? err.message : 'LLM request failed',
    );
  }

  const toolUse = message.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === FOOD_TOOL.name,
  );

  // No structured output → treat as unrecognized, never a 500 (handoff §10).
  if (!toolUse) return emptyResult();

  return normalizeResult(toolUse.input);
}
