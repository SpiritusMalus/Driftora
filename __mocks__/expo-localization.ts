/// Test stub for the native `expo-localization` module (mapped in via the jest
/// `moduleNameMapper`). The app only uses `getLocales()[0].regionCode` for the
/// default nutrition region; returning a fixed US locale keeps region-dependent
/// units pure and deterministic in node, without pulling the native ESM module.
export function getLocales(): { regionCode: string | null }[] {
  return [{ regionCode: 'US' }];
}
