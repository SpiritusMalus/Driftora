/// "Grove" palette — restrained olive + charcoal. Editorial and calm rather than
/// clinical: the product leads with one typographic insight, not a dashboard of
/// rings, so the palette stays quiet and lets the hero sentence carry the screen.
/// Non-judgmental, low-pressure — no alarming reds for "limits".
export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  border: string;
  primary: string;
  text: string;
  subtle: string;
  icon: string;
  iconBg: string;
  /// Strong ink for the editorial hero sentence (near-charcoal).
  heroText: string;
  /// Olive accent for the emphasized part of the hero (the "+N to mood" figure).
  heroAccent: string;
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F4F4EF', // warm paper, faint olive cast
    surface: '#FBFBF7',
    card: '#FBFBF7',
    border: '#E2E2D6',
    primary: '#6B7045', // muted olive
    text: '#23241D', // charcoal-olive ink
    subtle: '#6E7064', // dim olive-grey
    icon: '#6B7045',
    iconBg: '#E7E8DA',
    heroText: '#1E1F18',
    heroAccent: '#5C6238',
  },
  dark: {
    background: '#15160F', // deep charcoal with an olive undertone
    surface: '#1C1D15',
    card: '#1C1D15',
    border: '#2D2F22',
    primary: '#A9B07A', // soft olive on dark
    text: '#ECEDE0',
    subtle: '#9C9E8C',
    icon: '#A9B07A',
    iconBg: '#262819',
    heroText: '#F1F2E6',
    heroAccent: '#B9C089',
  },
};
