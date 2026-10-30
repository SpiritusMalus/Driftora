import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The pinned "tell or type what you ate" bar at the bottom of Home — a pencil
/// glyph, a muted placeholder, and a circular mic. Tapping the bar opens the
/// food log for typing; tapping the mic opens it primed for voice. Both keep
/// the same circular microphone with the flat blue action fill.
export function FoodBar({
  placeholder,
  onPressText,
  onPressMic,
}: {
  placeholder: string;
  onPressText: () => void;
  onPressMic: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  // The microphone takes the same readable on-primary ink as PrimaryButton.
  const mic = (
    <Ionicons name="mic-outline" size={22} color={theme.onPrimary} />
  );

  return (
    <Pressable
      onPress={onPressText}
      style={({ pressed }) => [
        styles.bar,
        theme.isIOS ? styles.barIOS : styles.barAndroid,
        {
          backgroundColor: theme.card,
          borderColor: theme.cardBorder,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <Ionicons name="create-outline" size={18} color={theme.tertiary} />
      <Text numberOfLines={1} style={[styles.placeholder, { color: theme.subtle }, theme.font.body]}>
        {placeholder}
      </Text>
      <Pressable
        onPress={onPressMic}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('food.voice')}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
      >
        {theme.isIOS ? (
          <View style={[styles.micIOS, { backgroundColor: theme.primary }]}>{mic}</View>
        ) : (
          <LinearGradient
            colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.micAndroid}
          >
            {mic}
          </LinearGradient>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
  },
  barAndroid: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  barIOS: {
    borderRadius: 10,
  },
  placeholder: { flex: 1, fontSize: 14 },
  micAndroid: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIOS: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
