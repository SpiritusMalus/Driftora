import {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
  GolosText_700Bold,
} from '@expo-google-fonts/golos-text';
import type { TextStyle } from 'react-native';

/// One Golos Text family carries words and figures throughout Driftora.
/// The existing role names stay stable for all screen call sites.
/// `fontAssets` is the map handed to `useFonts` in the root layout; `fonts`
/// holds the family-name strings to use in styles once they're loaded.
export const fontAssets = {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
  GolosText_700Bold,
};

export const fonts = {
  /// Strongest existing display role.
  displayHeavy: 'GolosText_700Bold',
  /// Big display — hero figures, large numbers.
  display: 'GolosText_500Medium',
  /// Titles, section headers, eyebrows.
  heading: 'GolosText_600SemiBold',
  /// Body copy.
  body: 'GolosText_400Regular',
  bodyMedium: 'GolosText_500Medium',
  bodySemiBold: 'GolosText_600SemiBold',
  bodyBold: 'GolosText_700Bold',
} as const;

/// React Native point sizes keep the default system font scaling. Numeric
/// roles align columns without swapping to a separate monospace family.
export const typeScale = {
  title: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 35, letterSpacing: -0.6 },
  section: { fontFamily: fonts.bodyMedium, fontSize: 21, lineHeight: 28, letterSpacing: -0.35 },
  body: { fontFamily: fonts.body, fontSize: 17, lineHeight: 25 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  calorie: { fontFamily: fonts.display, fontSize: 50, lineHeight: 58, letterSpacing: -1.8, fontVariant: ['tabular-nums'] },
  macro: { fontFamily: fonts.display, fontSize: 24, lineHeight: 31, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;
