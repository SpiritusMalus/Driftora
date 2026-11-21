/// Driftora's daily diary: matte graphite / warm ivory with a single action tint.
/// Roles remain stable so all existing routes inherit the same visual system.
export interface ThemeColors {
  background: string;
  surface: string;
  surface2: string;
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
  protein: string;
  fat: string;
  carb: string;
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F8F5ED',
    surface: '#EEEBE2',
    surface2: '#E3E0D7',
    card: '#EEEBE2',
    border: '#D6D7CE',
    primary: '#4F655A',
    onPrimary: '#FFFDF5',
    text: '#263336',
    subtle: '#526165',
    icon: '#526165',
    iconBg: '#E3E0D7',
    accent: '#526165',
    heroText: '#263336',
    heroAccent: '#4F655A',
    protein: '#954B40',
    fat: '#7D5B27',
    carb: '#42677A',
  },
  dark: {
    background: '#151D20',
    surface: '#202A2E',
    surface2: '#2A363B',
    card: '#202A2E',
    border: '#354246',
    primary: '#EBD49B',
    onPrimary: '#30291A',
    text: '#F5F0E8',
    subtle: '#B0BDBF',
    icon: '#B0BDBF',
    iconBg: '#2A363B',
    accent: '#B0BDBF',
    heroText: '#F5F0E8',
    heroAccent: '#EBD49B',
    protein: '#E1AA9E',
    fat: '#E0C899',
    carb: '#A4C3D1',
  },
};
