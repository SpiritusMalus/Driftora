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
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.25,
    marginTop: 26,
    marginBottom: 10,
  },
});
