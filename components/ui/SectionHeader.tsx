import { StyleSheet, Text } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// Existing section labels, with restrained tracking and shared secondary ink.
export function SectionHeader({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text
      style={[
        styles.heading,
        { color: theme.text },
        theme.font.heading,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: 21,
    lineHeight: 28,
    letterSpacing: -0.35,
    marginTop: 28,
    marginBottom: 14,
  },
});
