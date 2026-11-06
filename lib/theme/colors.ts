/// «Лента дня»: quiet paper, green ink and one blue action/selection accent.
/// Both schemes share the same roles so the existing screens and controls can
/// adopt the visual direction without changing their layout or behavior.
export interface ThemeColors {
  background: string;
  surface: string;
  card: string;
  border: string;
  /// Brand/action accent (buttons, icons, links, «today»).
  primary: string;
  /// Readable text/label color to place on top of `primary` fills.
  onPrimary: string;
  text: string;
  subtle: string;
  icon: string;
  iconBg: string;
  /// Secondary ink (quiet highlights), readable as body text in both schemes.
  accent: string;
  /// Strong ink for the existing hero sentence.
  heroText: string;
  /// Accent for the emphasized part of the hero (the big figure).
  heroAccent: string;
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F2F3EB',
    surface: '#F2F3EB',
    card: '#F2F3EB',
    border: '#CDD5C8',
    primary: '#2449D8',
    onPrimary: '#FFFFFF',
    text: '#17302A',
    subtle: '#59685E',
    icon: '#59685E',
    iconBg: '#E7EBDD',
    accent: '#59685E',
    heroText: '#17302A',
    heroAccent: '#2449D8',
  },
  dark: {
    background: '#19231F',
    surface: '#19231F',
    card: '#19231F',
    border: '#425246',
    primary: '#A4B8FF',
    onPrimary: '#142A66',
    text: '#F0F1E7',
    subtle: '#ADBBAE',
    icon: '#ADBBAE',
    iconBg: '#27392E',
    accent: '#ADBBAE',
    heroText: '#F0F1E7',
    heroAccent: '#A4B8FF',
  },
};
