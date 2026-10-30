import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// Existing section labels, with restrained tracking and shared secondary ink.
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
    letterSpacing: 0.6,
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
