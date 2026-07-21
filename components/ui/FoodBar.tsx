import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The pinned "tell or type what you ate" bar at the bottom of Home — a pencil
/// glyph, a muted placeholder, and a circular mic. Tapping the bar opens the
/// food log for typing; tapping the mic opens it primed for voice. Android gives
/// the mic a coral gradient and glow; iOS uses a flat coral disc.
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
  // Icon sits on the coral disc/gradient — same surface as PrimaryButton, so it
  // takes the same on-primary token (dark ink on the lighter dark-mode coral).
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
        !theme.isIOS && { shadowColor: '#14212E' },
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
            style={[styles.micAndroid, { shadowColor: theme.primary }]}
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
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
  },
  barIOS: {
    borderRadius: 22,
    shadowOpacity: 0.12,
    shadowColor: '#14212E',
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  placeholder: { flex: 1, fontSize: 14 },
  micAndroid: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  micIOS: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
