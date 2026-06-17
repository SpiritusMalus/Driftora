import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The primary call-to-action. Android fills it with the coral gradient and a
/// soft coral glow; iOS uses a flat coral fill (no gradient/shadow), matching
/// the native handoff. Disabled state dims to 40%.
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
      style={({ pressed }) => [
        styles.wrap,
        theme.isIOS ? { backgroundColor: theme.primary } : [styles.glow, { shadowColor: theme.primary }],
        { opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {theme.isIOS ? (
        <View style={styles.inner}>{text}</View>
      ) : (
        <LinearGradient
          colors={theme.primaryGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.inner}
        >
          {text}
        </LinearGradient>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 16 },
  glow: {
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  inner: {
    borderRadius: 16,
    overflow: 'hidden',
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16 },
});
