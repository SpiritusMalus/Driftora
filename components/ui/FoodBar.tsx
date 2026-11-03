import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// Two direct entry points share the pinned blue action bar: text opens the
/// existing food composer, and the microphone opens that composer for voice.
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
  return (
    <View style={[styles.bar, { backgroundColor: theme.primary }]}>
      <Pressable
        onPress={onPressText}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
        style={({ pressed }) => [styles.textButton, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="create-outline" size={20} color={theme.onPrimary} />
        <Text style={[styles.placeholder, { color: theme.onPrimary }, theme.font.bodyMedium]}>
          {placeholder}
        </Text>
      </Pressable>
      <View
        pointerEvents="none"
        style={[styles.divider, { backgroundColor: theme.onPrimary }]}
      />
      <Pressable
        onPress={onPressMic}
        accessibilityRole="button"
        accessibilityLabel={t('food.voice')}
        style={({ pressed }) => [styles.micButton, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="mic-outline" size={22} color={theme.onPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 57,
    borderRadius: 16,
    overflow: 'hidden',
  },
  textButton: {
    flex: 1,
    minHeight: 57,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 17,
    paddingRight: 12,
    paddingVertical: 12,
  },
  placeholder: { flex: 1, fontSize: 15 },
  divider: { width: 1, height: 24, opacity: 0.28 },
  micButton: {
    width: 57,
    minHeight: 57,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
