import {
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
  GolosText_700Bold,
} from '@expo-google-fonts/golos-text';
import {
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
  JetBrainsMono_800ExtraBold,
} from '@expo-google-fonts/jetbrains-mono';

/// «Миллиметровка» type system. JetBrains Mono is the instrument voice — hero
/// figures and big numbers read as tabular lab-journal digits (native cyrillic,
/// real 700/800 weights; PT Mono was rejected for having a single weight).
/// Golos Text carries body copy and headings — native cyrillic, civil and
/// neutral. The handoff keeps system SF for body on iOS; these are the
/// cross-platform faces we ship so Android/web look consistent.
///
/// `fontAssets` is the map handed to `useFonts` in the root layout; `fonts`
/// holds the family-name strings to use in styles once they're loaded.
export const fontAssets = {
  JetBrainsMono_800ExtraBold,
  JetBrainsMono_700Bold,
  JetBrainsMono_600SemiBold,
  GolosText_400Regular,
  GolosText_500Medium,
  GolosText_600SemiBold,
  GolosText_700Bold,
};

export const fonts = {
  /// Heaviest display — the hero "+gap" figure (HERO_BRIDGE_SPEC).
  displayHeavy: 'JetBrainsMono_800ExtraBold',
  /// Big display — hero figures, large numbers.
  display: 'JetBrainsMono_700Bold',
  /// Titles, section headers, eyebrows.
  heading: 'GolosText_600SemiBold',
  /// Body copy.
  body: 'GolosText_400Regular',
  bodyMedium: 'GolosText_500Medium',
  bodySemiBold: 'GolosText_600SemiBold',
  bodyBold: 'GolosText_700Bold',
} as const;
