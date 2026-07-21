/// «Миллиметровка» — the engineering-journal visual direction (pitched
/// 2026-07-20, replaces the Ember cream/coral reference). The app reads as an
/// honest lab sheet of the body: cool graph-paper white, tabular mono figures,
/// graphite support ink, and ONE red-pencil accent for actions and «today».
/// Dark mode is not a grey dark — it is a blueprint (цианотипия/синька): deep
/// Prussian blue with chalk text and a signal-red accent. Non-judgmental as
/// before: red is the brand accent and the «now» marker, never an "error red".
/// Swapping the whole visual world again = editing THIS file (+ the derived
/// tokens in theme.ts); every screen consumes tokens only.
export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  border: string;
  /// Red pencil — the brand/primary accent (buttons, icons, links, «today»).
  primary: string;
  /// Readable text/label color to place on top of `primary` fills.
  onPrimary: string;
  text: string;
  subtle: string;
  icon: string;
  iconBg: string;
  /// Graphite secondary (streaks, quiet highlights). ≥4.5:1 as text on the
  /// body background in BOTH schemes — the old amber failed that in light.
  accent: string;
  /// Strong ink for the editorial hero sentence (blue-black journal ink).
  heroText: string;
  /// Red-pencil accent for the emphasized part of the hero (the big figure).
  heroAccent: string;
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#FBFBF8', // graph-paper white
    surface: '#FFFFFF',
    card: '#FFFFFF',
    border: '#DCE3E8', // cool grid hairline
    primary: '#C93524', // red pencil (5.0:1 on the paper bg — small text safe)
    onPrimary: '#FFFFFF',
    text: '#1F262B', // journal ink
    subtle: '#5B6870', // graphite (5.5:1 on bg)
    icon: '#3E5461', // graphite-blue glyphs; red stays for actions only
    iconBg: '#EDF2F5', // pale grid tint behind icons
    accent: '#44606E', // graphite highlight — replaces amber
    heroText: '#1A2126',
    heroAccent: '#C93524',
  },
  dark: {
    background: '#12283C', // blueprint Prussian
    surface: '#193853',
    card: '#193853',
    border: '#2B4C6C', // chalk hairline on the blueprint
    primary: '#FF6250', // signal red, lifted for dark (5:1 on the blueprint bg;
    // deliberately REDDER than Ember's #F08365 salmon — the first device build
    // read as «старый коралл», device feedback 2026-07-20)
    onPrimary: '#2A0F09', // dark ink reads better on the lighter red
    text: '#E8EFF5', // chalk
    subtle: '#9DB4C6', // faded chalk (7:1 on bg)
    icon: '#BCD3E4',
    iconBg: '#20415E',
    accent: '#8FB4CE', // chalk-blue highlight
    heroText: '#E8EFF5',
    heroAccent: '#FF6250',
  },
};
