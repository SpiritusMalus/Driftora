import { Platform, type TextStyle, useColorScheme } from 'react-native';

import { colors } from './colors';
import { iosSurfaces } from './iosSurfaces';
import { fonts } from './typography';

/// Shared «Лента дня» color/type roles with the existing platform affordances.
/// The role API is unchanged: this layer recolors and retypes the current
/// screen tree instead of changing its controls or navigation.
const brandFont = {
  displayHeavy: { fontFamily: fonts.displayHeavy, fontVariant: ['tabular-nums'] },
  display: { fontFamily: fonts.display, fontVariant: ['tabular-nums'] },
  heading: { fontFamily: fonts.heading },
  body: { fontFamily: fonts.body },
  bodyMedium: { fontFamily: fonts.bodyMedium },
  bodySemiBold: { fontFamily: fonts.bodySemiBold },
  bodyBold: { fontFamily: fonts.bodyBold },
} satisfies Record<string, TextStyle>;

export type FontRole = keyof typeof brandFont;
export type FontMap = Record<FontRole, TextStyle>;

export interface Theme {
  scheme: 'light' | 'dark';
  isIOS: boolean;

  // Brand accents — shared across platforms.
  primary: string;
  onPrimary: string;
  accent: string;
  heroText: string;
  heroAccent: string;
  /// Compatibility stops for existing gradient components; equal for flat fills.
  primaryGradient: [string, string];
  /// Compatibility stops behind the existing Body↔Mind card; equal and flat.
  bodyMindGradient: string[];
  bodyMindBorder: string;
  bodyMindEyebrow: string;
  /// Soft tinted tiles for the existing Body and Mind glyphs.
  primarySoft: string;
  accentSoft: string;
  /// Existing uppercase section labels.
  labelCaps: string;
  /// 0–10 mood scale: empty-pill fill + the number printed on it.
  moodTrack: string;
  moodTrackNum: string;
  /// Legacy glow token; transparent in this visual direction.
  glow: string;

  // Surfaces — platform-aware.
  background: string;
  card: string;
  /// Card outline: a paper hairline on Android, transparent on iOS (grouped
  /// cards have no border, only inset separators between rows).
  cardBorder: string;
  /// iOS inset row separator (0.5px). Android uses `cardBorder` hairlines.
  separator: string;
  /// Secondary icon ink.
  icon: string;
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
  const palette = colors[scheme];
  const sys = iosSurfaces[scheme];
  const light = scheme === 'light';

  return {
    scheme,
    isIOS,

    primary: palette.primary,
    onPrimary: palette.onPrimary,
    accent: palette.accent,
    heroText: palette.heroText,
    heroAccent: palette.heroAccent,
    primaryGradient: [palette.primary, palette.primary],
    bodyMindGradient: [palette.card, palette.card],
    bodyMindBorder: palette.border,
    bodyMindEyebrow: palette.subtle,
    primarySoft: light ? '#E0E6F5' : '#283B58',
    accentSoft: palette.iconBg,
    labelCaps: palette.subtle,
    moodTrack: palette.iconBg,
    moodTrackNum: palette.subtle,
    glow: 'transparent',

    background: isIOS ? sys.background : palette.background,
    card: isIOS ? sys.card : palette.card,
    cardBorder: isIOS ? 'transparent' : palette.border,
    separator: isIOS ? sys.separator : palette.border,
    icon: palette.icon,
    iconBg: palette.iconBg,
    fill: isIOS ? sys.fill : palette.iconBg,

    text: isIOS ? sys.text : palette.text,
    subtle: isIOS ? sys.subtle : palette.subtle,
    tertiary: isIOS ? sys.tertiary : palette.subtle,

    font: brandFont,
  };
}
