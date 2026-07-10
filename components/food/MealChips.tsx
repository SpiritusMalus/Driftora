import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MEAL_ORDER, type MealType } from '@/lib/core/insights/mealType';
import { useTheme } from '@/lib/theme/theme';

/// Meal-of-day picker (Завтрак/Обед/Полдник/Ужин) shared by the log and edit
/// screens. The clock preselects a chip, but the USER's tap is what gets stored
/// — a late breakfast at 11:41 stays завтрак because they said so, not обед
/// because the clock said so (device feedback 2026-07-10).
export function MealChips({ value, onChange }: { value: MealType; onChange: (meal: MealType) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('food.mealPick.label')}</Text>
      <View style={styles.chips}>
        {MEAL_ORDER.map((m) => {
          const active = value === m;
          return (
            <Pressable
              key={m}
              onPress={() => onChange(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(`food.meal.${m}`)}
              style={({ pressed }) => [
                styles.chip,
                {
                  backgroundColor: active ? theme.primary : theme.card,
                  borderColor: active ? theme.primary : theme.separator,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? theme.onPrimary : theme.text },
                  active ? theme.font.bodySemiBold : theme.font.body,
                ]}
              >
                {t(`food.meal.${m}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  label: { fontSize: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13 },
});
