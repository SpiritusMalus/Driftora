import { Platform, type TextStyle, useColorScheme } from 'react-native';

import { colors } from './colors';

/// Unified, platform-aware theme. The app ships two distinct looks from the
/// «Миллиметровка» direction (engineering journal, pitched 2026-07-20;
/// replaced the Ember cream/coral handoff):
///
///   • Android — graph-paper white with journal ink, tabular JetBrains Mono
///     figures, Golos Text body, ONE red-pencil accent; dark mode is a
///     blueprint (синька): Prussian blue + chalk. The grid texture itself
///     lives in hero components, not here.
///   • iOS — native grouped UI: systemGroupedBackground, inset white cards with
///     hairline row separators, large titles, liquid-glass header, SF system
///     type (flat red accent, no gradients/glow).
///
/// `useTheme()` resolves the right surface/text/font tokens for the current
/// platform and color scheme. Brand accents (red pencil, graphite) are shared;
/// only the surfaces, separators and typography diverge. Components spread
/// `theme.font.*` into their text styles so weight maps to JetBrains Mono/
/// Golos Text on Android and to SF system weights on iOS.

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

/// Font weight fragments. On Android they name the loaded JetBrains Mono /
/// Golos Text faces (mono = figures, Golos = words); on iOS they carry only a
/// weight so the system SF face is used.
const androidFont = {
  displayHeavy: { fontFamily: 'JetBrainsMono_800ExtraBold' },
  display: { fontFamily: 'JetBrainsMono_700Bold' },
  heading: { fontFamily: 'GolosText_600SemiBold' },
  body: { fontFamily: 'GolosText_400Regular' },
  bodyMedium: { fontFamily: 'GolosText_500Medium' },
  bodySemiBold: { fontFamily: 'GolosText_600SemiBold' },
  bodyBold: { fontFamily: 'GolosText_700Bold' },
} satisfies Record<string, TextStyle>;

const iosFont = {
  displayHeavy: { fontWeight: '800' },
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
    primaryGradient: light ? ['#D8492F', '#C93524'] : ['#FF7A5F', '#F04B33'],
    bodyMindGradient: light ? ['#F4F8FA', '#E9F0F4'] : ['#17344F', '#1C3E5D', '#21496C'],
    bodyMindBorder: light ? '#D7E1E8' : '#2B4C6C',
    bodyMindEyebrow: light ? '#5E7B8D' : '#8FB4CE',
    // Soft tiles. Light keeps a faint red-pencil shading; DARK tiles are cool
    // steel — on the blueprint a warm-brown tile reads as un-repainted Ember
    // (device feedback 2026-07-20: «не всё покрасилось»). On синька the
    // identity lives in the GLYPH color (red vs chalk), never the tile.
    primarySoft: light ? '#F8DFDA' : '#24425C',
    accentSoft: light ? '#E6EEF3' : '#1E3A52',
    labelCaps: light ? '#7A8B96' : '#7FA0B8',
    moodTrack: light ? '#EDF2F5' : '#20415E',
    moodTrackNum: light ? '#7E929E' : '#9DB4C6',
    glow: light ? 'rgba(201,53,36,0.35)' : 'rgba(220,60,40,0.38)',

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
