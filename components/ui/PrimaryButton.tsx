import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The existing primary action, with a flat blue fill on both platforms.
/// Disabled state dims to 40%; the component geometry and press behavior stay.
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
        { backgroundColor: theme.primary },
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
  wrap: { borderRadius: 6 },
  inner: {
    borderRadius: 6,
    overflow: 'hidden',
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 16 },
});
