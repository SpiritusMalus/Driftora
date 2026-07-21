/**
 * Client-side view of the server's per-install AI budget (the
 * `X-AI-Quota-Remaining` response header). A module-level cell, not React
 * state: the food screen reads it right after a parse lands (it re-renders on
 * the draft anyway) and shows a quiet «осталось N» once the number runs low —
 * the honest alternative to a surprise «лимит» at the day's fifth meal.
 */

let _remaining: number | null = null;

export function setAiQuotaRemaining(n: number | null): void {
  _remaining = n;
}

/** Null = the server never reported a budget (old server, or quota disabled). */
export function getAiQuotaRemaining(): number | null {
  return _remaining;
}
