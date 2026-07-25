import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, ChipRow } from '@/components/ui/Chip';
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
      <ChipRow>
        {MEAL_ORDER.map((m) => (
          <Chip
            key={m}
            label={t(`food.meal.${m}`)}
            selected={value === m}
            onPress={() => onChange(m)}
            boldWhenSelected
          />
        ))}
      </ChipRow>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  label: { fontSize: 12, marginBottom: 6 },
});
