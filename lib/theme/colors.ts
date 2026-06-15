/// Calm, supportive palette (teal-green). Non-judgmental, low-pressure — no
/// alarming reds for "limits".
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
}

export const colors: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    background: '#F5F8F7',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    border: '#E2ECE9',
    primary: '#3E8E7E',
    text: '#16201D',
    subtle: '#5B6B66',
    icon: '#3E8E7E',
    iconBg: '#DCEFE9',
  },
  dark: {
    background: '#0F1513',
    surface: '#161D1B',
    card: '#161D1B',
    border: '#243230',
    primary: '#5FB3A1',
    text: '#E7EFEC',
    subtle: '#9BB0AA',
    icon: '#5FB3A1',
    iconBg: '#1E2A27',
  },
};
