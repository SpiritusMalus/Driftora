/**
 * Client-side view of the server's per-install AI budget (the
 * `X-AI-Quota-Remaining` / `X-AI-Quota-Scope` response headers). A module-level
 * cell, not React state: the food screen reads it right after a parse lands (it
 * re-renders on the draft anyway) and shows a quiet «осталось N» once the number
 * runs low — the honest alternative to a surprise «лимит» at the day's fifth
 * meal.
 *
 * THE SCOPE IS NOT DECORATION. The free tier is a lifetime trial and the paid
 * one a daily allowance, so the same «осталось 3» has to read as «and then it's
 * over» in one case and «until tomorrow» in the other. Guessing wrong is a lie
 * in the one sentence about the limit the user actually sees.
 */

/** 'total' = the free lifetime trial. 'day' = a budget that comes back at UTC midnight. */
export type AiQuotaScope = 'total' | 'day';

let _remaining: number | null = null;
let _scope: AiQuotaScope | null = null;

export function setAiQuotaRemaining(n: number | null): void {
  _remaining = n;
}

/** Null = the server never reported a budget (old server, or quota disabled). */
export function getAiQuotaRemaining(): number | null {
  return _remaining;
}

export function setAiQuotaScope(scope: AiQuotaScope | null): void {
  _scope = scope;
}

/** Null = unreported. Callers must then say nothing about WHEN the budget returns. */
export function getAiQuotaScope(): AiQuotaScope | null {
  return _scope;
}
