import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A section eyebrow above a group of cards/rows. Android renders it as a tight
/// uppercase Unbounded label; iOS as a grouped-list header (uppercase
/// secondaryLabel, indented to the card inset).
export function SectionHeader({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      style={[
        theme.isIOS ? styles.ios : styles.android,
        { color: theme.subtle },
        theme.font.heading,
        theme.isIOS && { fontWeight: '400' },
      ]}
    >
      {children.toUpperCase()}
    </Text>
  );
}

const styles = StyleSheet.create({
  android: {
    fontSize: 12,
    letterSpacing: 1.2,
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
