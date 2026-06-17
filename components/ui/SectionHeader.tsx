import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A section eyebrow above a group of cards/rows. Android renders it as a warm
/// `labelCaps` Manrope-bold caps label (UI_HANDOFF §2/§8); iOS as a grouped-list
/// header (uppercase secondaryLabel, indented to the card inset).
export function SectionHeader({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      style={[
        theme.isIOS ? styles.ios : styles.android,
        { color: theme.isIOS ? theme.subtle : theme.labelCaps },
        theme.isIOS ? [theme.font.body, { fontWeight: '400' as const }] : theme.font.bodyBold,
      ]}
    >
      {children.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  android: {
    fontSize: 12,
    letterSpacing: 1.44,
    marginTop: 18,
    marginBottom: 10,
  },
  ios: {
    fontSize: 13,
    letterSpacing: -0.08,
    marginTop: 22,
    marginBottom: 6,
    marginLeft: 20,
  },
});
