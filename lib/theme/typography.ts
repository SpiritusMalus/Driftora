import {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
} from '@expo-google-fonts/golos-text';

/// One Golos Text family carries words and figures in «Ленте дня».
/// The existing role names stay stable for all screen call sites.
/// `fontAssets` is the map handed to `useFonts` in the root layout; `fonts`
/// holds the family-name strings to use in styles once they're loaded.
export const fontAssets = {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
};

export const fonts = {
  /// Strongest existing display role.
  displayHeavy: 'GolosText_600SemiBold',
  /// Big display — hero figures, large numbers.
  display: 'GolosText_500Medium',
  /// Titles, section headers, eyebrows.
  heading: 'GolosText_500Medium',
  /// Body copy.
  body: 'GolosText_400Regular',
  bodyMedium: 'GolosText_500Medium',
  bodySemiBold: 'GolosText_600SemiBold',
  bodyBold: 'GolosText_600SemiBold',
} as const;
