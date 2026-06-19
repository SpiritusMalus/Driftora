import * as Localization from 'expo-localization';

import type { FoodParser, Region } from './foodParser';
import { HttpFoodParser } from './httpFoodParser';
import { pickRegion } from './region';
import { StubFoodParser } from './stubFoodParser';

// The offline stub is stateless and reused across calls; the online parser is
// (re)built only while the user holds AI consent, so it can never linger once
// consent is withdrawn.
let _stub: StubFoodParser | null = null;
let _online: HttpFoodParser | null = null;

function stub(): StubFoodParser {
  return (_stub ??= new StubFoodParser());
}

/**
 * Returns the active food parser, given the user's cross-border AI consent.
 *
 * HARD GATE (TASK-2026-06-19 §B / DATA_PRIVACY_HANDOFF §5): the online
 * [HttpFoodParser] — the app's ONLY external network call — is used only when
 * BOTH `EXPO_PUBLIC_FOOD_API_URL` is set AND `aiConsent === true`. In every
 * other case the fully-offline [StubFoodParser] is returned and the server is
 * never contacted, so nothing leaves the device without opt-in consent. The
 * general entry-gate consent is deliberately NOT this flag (separate consents).
 */
export function getFoodParser(aiConsent: boolean): FoodParser {
  const base = process.env.EXPO_PUBLIC_FOOD_API_URL;
  if (!base || !aiConsent) return stub();
  return (_online ??= new HttpFoodParser(base, stub()));
}

/**
 * The nutrition region for lookups (BUILD SPEC §2): the in-app setting wins
 * unless it's 'auto', in which case the device locale decides. Pure logic lives
 * in `pickRegion` (region.ts) — tested without the native locale dep.
 */
export function resolveRegion(setting?: 'auto' | 'RU' | 'US' | null): Region {
  return pickRegion(setting, Localization.getLocales?.()[0]?.regionCode ?? null);
}
