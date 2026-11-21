import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// One matte action tint, a comfortable native touch target, and scaling text.
export function PrimaryButton({
  label,
  onPress,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const text = (
    <Text style={[styles.label, { color: theme.onPrimary }, theme.font.bodySemiBold]}>{label}</Text>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.wrap,
        { backgroundColor: theme.primary },
        { opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <View style={styles.inner}>{text}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 13 },
  inner: {
    borderRadius: 13,
    overflow: 'hidden',
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
});
