/**
 * Shared per-provider fetch timeouts (bug fix — 2026-07-05). Every OUTBOUND
 * call to a third-party service must bound its wait: a slow/hanging upstream
 * must never hold a `/food/parse*` request (or the process) hostage.
 *
 * Use as `fetch(url, { ..., signal: AbortSignal.timeout(TIMEOUT_MS.foo) })`.
 * `AbortSignal.timeout` rejects the fetch with a `DOMException` named
 * `'AbortError'` — callers' existing `try { await fetch(...) } catch { ... }`
 * blocks already treat any thrown error as a network miss, so no new
 * branching is needed at call sites.
 */
export const TIMEOUT_MS = {
  /**
   * OpenRouter, FIRST attempt. Deliberately shorter than a patient wait: a
   * degenerate decode loop has a time signature. Measured on this model — a
   * healthy identification lands in 8–16 s, a looping one runs 26–37 s before
   * hitting the token ceiling and returning garbage anyway. Cutting at 17 s
   * therefore costs almost no real answers while catching the loop early enough
   * to re-roll inside the user's patience. Waiting longer buys a broken reply.
   */
  openrouter: 17_000,
  /**
   * OpenRouter, RETRY after a timeout or a truncation. Roomier: this attempt is
   * the one that has to land, and a re-roll that is merely slow must not be
   * killed for it. First + retry stays under the client's upload budget.
   */
  openrouterRetry: 26_000,
  /**
   * Typed-TEXT calls where failing fast is acceptable (identify, workout
   * parse, label translate — NOT the estimator, whose timeout erases the
   * answer; it keeps the patient pair above), both attempts. A typed query is
   * answered in 3–6 s and
   * the user is actively waiting on it, so the failure ceiling has to stay near
   * the answer time: better to fail at 22 s and let them retype than to hold the
   * screen for 43 s. Photos get the patient budget above — there the user has
   * already committed a picture and a slow answer still beats none.
   */
  openrouterText: 10_000,
  openrouterTextRetry: 12_000,
  /** USDA FoodData Central `/foods/search`. */
  usda: 8_000,
  /** API Ninjas `/v1/nutrition`. */
  apininjas: 8_000,
  /** FatSecret OAuth token fetch + `/foods/search`. */
  fatsecret: 8_000,
  /** Open Food Facts barcode product lookup (the free-text search already had its own). */
  openfoodfacts: 8_000,
} as const;
