import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/// HARD INVARIANT (TASK §B / DATA_PRIVACY_HANDOFF §5): the online parser is
/// unreachable unless BOTH `EXPO_PUBLIC_FOOD_API_URL` is set AND
/// `aiFoodParseConsent === true`. Every other combination must yield the
/// offline stub so nothing leaves the device without opt-in consent.
///
/// getFoodParser memoizes the online instance, so each case re-evaluates the
/// module fresh (jest.isolateModules) to start from a clean cache. The class
/// identity is read inside the same isolation as the instance, so we compare
/// against the SAME module realm (a top-level import would be a different
/// realm and never match). `expo-localization` / `expo/virtual/env` are mapped
/// to node stubs via jest moduleNameMapper.

// Referenced via a computed key so babel-preset-expo doesn't rewrite a literal
// `process.env.EXPO_PUBLIC_*` into an `expo/virtual/env` import.
const ENV_KEY = 'EXPO_PUBLIC_FOOD_API_URL';
const ORIGINAL_URL = process.env[ENV_KEY];

/// Returns which parser class getFoodParser picks: 'stub' or 'http'.
function parserKindFor(url: string | undefined, consent: boolean): 'stub' | 'http' {
  if (url === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = url;

  let kind: 'stub' | 'http' = 'stub';
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const mod = require('@/lib/core/services/foodParserProvider');
    const { HttpFoodParser } = require('@/lib/core/services/httpFoodParser');
    /* eslint-enable @typescript-eslint/no-var-requires */
    kind = mod.getFoodParser(consent) instanceof HttpFoodParser ? 'http' : 'stub';
  });
  return kind;
}

beforeEach(() => {
  delete process.env[ENV_KEY];
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = ORIGINAL_URL;
});

describe('getFoodParser consent + URL gate', () => {
  const URL = 'https://api.example.com/food/parse';

  it('uses the offline stub when no URL is configured, even with consent', () => {
    expect(parserKindFor(undefined, true)).toBe('stub');
  });

  it('uses the offline stub when a URL is set but consent is false', () => {
    expect(parserKindFor(URL, false)).toBe('stub');
  });

  it('uses the offline stub when neither URL nor consent is present', () => {
    expect(parserKindFor(undefined, false)).toBe('stub');
  });

  it('uses the online HttpFoodParser ONLY when URL is set AND consent is true', () => {
    expect(parserKindFor(URL, true)).toBe('http');
  });
});
