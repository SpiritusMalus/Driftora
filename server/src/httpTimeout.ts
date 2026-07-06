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
  /** OpenRouter chat-completions (identify from text/photo/audio) — largest payloads. */
  openrouter: 20_000,
  /** USDA FoodData Central `/foods/search`. */
  usda: 8_000,
  /** API Ninjas `/v1/nutrition`. */
  apininjas: 8_000,
  /** FatSecret OAuth token fetch + `/foods/search`. */
  fatsecret: 8_000,
  /** Open Food Facts barcode product lookup (the free-text search already had its own). */
  openfoodfacts: 8_000,
} as const;
