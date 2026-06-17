import { Platform, type TextStyle, useColorScheme } from 'react-native';

import { colors } from './colors';

/// Unified, platform-aware theme. The app ships two distinct looks from the
/// "Ember" handoff (see Screens Ember.dc.html):
///
///   • Android — warm "Ember Тёплый": cream paper, gradient hero card, coral
///     glow on the primary button/FAB, Unbounded+Manrope brand type.
///   • iOS — native grouped UI: systemGroupedBackground, inset white cards with
///     hairline row separators, large titles, liquid-glass header, SF system
///     type (flat coral, no gradients/glow).
///
/// `useTheme()` resolves the right surface/text/font tokens for the current
/// platform and color scheme. Brand accents (coral, amber) are shared; only the
/// surfaces, separators and typography diverge. Components spread `theme.font.*`
/// into their text styles so weight maps to Unbounded/Manrope on Android and to
/// SF system weights on iOS.

/// Native iOS grouped-list surface tokens (Apple HIG system colors), kept
/// separate from the Ember/Android palette in `colors.ts`.
const iosSurfaces = {
  light: {
    background: '#F2F2F7', // systemGroupedBackground
    card: '#FFFFFF', // secondarySystemGroupedBackground
    separator: 'rgba(60,60,67,0.12)', // inset hairline from the mockup
    text: '#000000', // label
    subtle: 'rgba(60,60,67,0.6)', // secondaryLabel
    tertiary: 'rgba(60,60,67,0.3)', // tertiaryLabel / chevrons
    fill: '#F2F2F7', // tertiarySystemFill — inactive mood pills
  },
  dark: {
    background: '#000000',
    card: '#1C1C1E',
    separator: 'rgba(84,84,88,0.4)',
    text: '#FFFFFF',
    subtle: 'rgba(235,235,245,0.6)',
    tertiary: 'rgba(235,235,245,0.3)',
    fill: '#2C2C2E',
  },
};

/// Font weight fragments. On Android they name the loaded Unbounded/Manrope
/// faces; on iOS they carry only a weight so the system SF face is used.
const androidFont = {
  display: { fontFamily: 'Unbounded_700Bold' },
  heading: { fontFamily: 'Unbounded_600SemiBold' },
  body: { fontFamily: 'Manrope_400Regular' },
  bodyMedium: { fontFamily: 'Manrope_500Medium' },
  bodySemiBold: { fontFamily: 'Manrope_600SemiBold' },
  bodyBold: { fontFamily: 'Manrope_700Bold' },
} satisfies Record<string, TextStyle>;

const iosFont = {
  display: { fontWeight: '800' },
  heading: { fontWeight: '700' },
  body: { fontWeight: '400' },
  bodyMedium: { fontWeight: '500' },
  bodySemiBold: { fontWeight: '600' },
  bodyBold: { fontWeight: '600' },
} satisfies Record<string, TextStyle>;

export type FontRole = keyof typeof androidFont;
export type FontMap = Record<FontRole, TextStyle>;

export interface Theme {
  scheme: 'light' | 'dark';
  isIOS: boolean;

  // Brand accents — shared across platforms.
  primary: string;
  onPrimary: string;
  accent: string; // amber
  heroText: string;
  heroAccent: string;
  /// Coral gradient for the Android primary button / mic FAB (top-left → coral).
  primaryGradient: [string, string];
  /// Soft gradient behind the Body↔Mind hero card (Android). 2–3 stops.
  bodyMindGradient: string[];
  bodyMindBorder: string;
  bodyMindEyebrow: string;
  /// Soft tinted tiles for the hero's Body (coral) and Mind (amber) glyphs.
  primarySoft: string;
  accentSoft: string;
  /// UPPERCASE caps section labels (#B89684 light / #9C7E70 dark).
  labelCaps: string;
  /// 0–10 mood scale: empty-pill fill + the number printed on it.
  moodTrack: string;
  moodTrackNum: string;
  /// Coral glow color used for the Android FAB/button shadow.
  glow: string;

  // Surfaces — platform-aware.
  background: string;
  card: string;
  /// Card outline: a warm hairline on Android, transparent on iOS (grouped
  /// cards have no border, only inset separators between rows).
  cardBorder: string;
  /// iOS inset row separator (0.5px). Android uses `cardBorder` hairlines.
  separator: string;
  /// Tinted tile behind a row icon (Android). iOS uses small filled glyphs.
  iconBg: string;
  /// Neutral fill for inactive controls (iOS mood pills, input wells).
  fill: string;

  // Text.
  text: string;
  subtle: string;
  tertiary: string;

  font: FontMap;
}

export function useTheme(): Theme {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return resolveTheme(scheme);
}

export function resolveTheme(scheme: 'light' | 'dark'): Theme {
  const isIOS = Platform.OS === 'ios';
  const ember = colors[scheme];
  const sys = iosSurfaces[scheme];
  const light = scheme === 'light';

  return {
    scheme,
    isIOS,

    primary: ember.primary,
    onPrimary: ember.onPrimary,
    accent: ember.accent,
    heroText: ember.heroText,
    heroAccent: ember.heroAccent,
    primaryGradient: light ? ['#E86A4D', '#D8513A'] : ['#F08365', '#D8513A'],
    bodyMindGradient: light ? ['#FFF1EC', '#FBE0D6'] : ['#2E1A13', '#3A1F16', '#4A271C'],
    bodyMindBorder: light ? '#F6D7CB' : '#3E261C',
    bodyMindEyebrow: light ? '#B89684' : '#C79885',
    primarySoft: light ? '#FBE2D9' : '#3A241C',
    accentSoft: light ? '#FBEFD9' : '#33291A',
    labelCaps: light ? '#B89684' : '#9C7E70',
    moodTrack: light ? '#F4E6DD' : '#33261F',
    moodTrackNum: light ? '#B79C8F' : '#9C8175',
    glow: 'rgba(216,81,58,0.4)',

    background: isIOS ? sys.background : ember.background,
    card: isIOS ? sys.card : ember.card,
    cardBorder: isIOS ? 'transparent' : ember.border,
    separator: isIOS ? sys.separator : ember.border,
    iconBg: ember.iconBg,
    fill: isIOS ? sys.fill : ember.iconBg,

    text: isIOS ? sys.text : ember.text,
    subtle: isIOS ? sys.subtle : ember.subtle,
    tertiary: isIOS ? sys.tertiary : ember.subtle,

    font: isIOS ? iosFont : androidFont,
  };
}
