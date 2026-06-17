/// "Ember Тёплый" — the approved visual reference (see Screens Ember.dc.html).
/// Warm cream paper with a coral ember accent and an amber highlight; calm and
/// editorial rather than clinical. The product still leads with one typographic
/// insight, so the palette stays warm and quiet and lets the hero carry the
/// screen. Non-judgmental — coral is the brand accent, never an "error red".
export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  border: string;
  /// Coral ember — the brand/primary accent (buttons, icons, links).
  primary: string;
  /// Readable text/label color to place on top of `primary` fills.
  onPrimary: string;
  text: string;
  subtle: string;
  icon: string;
  iconBg: string;
  /// Amber secondary accent (streaks, highlights, small flourishes).
  accent: string;
  /// Strong ink for the editorial hero sentence (near-espresso brown).
  heroText: string;
  /// Coral accent for the emphasized part of the hero (the big figure).
  heroAccent: string;
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#FBF4EE', // warm cream paper
    surface: '#FFFFFF',
    card: '#FFFFFF',
    border: '#EBD9CE', // warm sand hairline
    primary: '#D8513A', // coral ember
    onPrimary: '#FFFFFF',
    text: '#2A1A14', // espresso ink
    subtle: '#8A6E63', // warm taupe
    icon: '#D8513A',
    iconBg: '#F6E9E2', // soft cream tint behind icons
    accent: '#E8A53D', // amber
    heroText: '#241813',
    heroAccent: '#D8513A',
  },
  dark: {
    background: '#17110E', // deep espresso
    surface: '#241813',
    card: '#241813',
    border: '#3A2A22', // warm brown hairline
    primary: '#F08365', // softened coral on dark
    onPrimary: '#241813', // dark ink reads better on the lighter coral
    text: '#F6E9E2', // warm cream
    subtle: '#B89A8C', // muted taupe
    icon: '#F08365',
    iconBg: '#33261F',
    accent: '#E8A53D', // amber holds on both themes
    heroText: '#F6E9E2',
    heroAccent: '#F08365',
  },
};
