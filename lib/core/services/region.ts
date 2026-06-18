import type { Region } from './foodParser';

/// Pure region decision (no native deps, so it's unit-testable): the in-app
/// setting wins unless it's 'auto', in which case the device-locale region code
/// decides — `appSettings.region ?? deviceLocale.region`. Defaults to US.
export function pickRegion(
  setting: 'auto' | 'RU' | 'US' | null | undefined,
  localeRegionCode: string | null,
): Region {
  if (setting === 'RU' || setting === 'US') return setting;
  return localeRegionCode === 'RU' ? 'RU' : 'US';
}
