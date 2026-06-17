import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  Unbounded_600SemiBold,
  Unbounded_700Bold,
  Unbounded_800ExtraBold,
} from '@expo-google-fonts/unbounded';

/// Ember type system. Unbounded is the display/accent voice (hero figures,
/// titles, eyebrows); Manrope carries body text. The handoff specifies system
/// SF for body on iOS — Manrope is the cross-platform body face we ship so the
/// look is consistent on Android/web too.
///
/// `fontAssets` is the map handed to `useFonts` in the root layout; `fonts`
/// holds the family-name strings to use in styles once they're loaded.
export const fontAssets = {
  Unbounded_800ExtraBold,
  Unbounded_700Bold,
  Unbounded_600SemiBold,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
};

export const fonts = {
  /// Heaviest display — the hero "+gap" figure (HERO_BRIDGE_SPEC).
  displayHeavy: 'Unbounded_800ExtraBold',
  /// Big display — hero figures, large numbers.
  display: 'Unbounded_700Bold',
  /// Titles, section headers, eyebrows.
  heading: 'Unbounded_600SemiBold',
  /// Body copy.
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
} as const;
