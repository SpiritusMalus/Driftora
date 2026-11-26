import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import type { MealDraft } from '@/lib/core/services/foodParser';
import { useTheme } from '@/lib/theme/theme';

export function MealFooterTotal({ draft, hideCalories }: { draft: MealDraft; hideCalories: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const value = hideCalories
    ? `${t('macros.protein').toLowerCase()} ${draft.totals.prot} ${t('units.g')}`
    : `${draft.totals.kcal} ${t('units.kcal')}`;

  if (!draft.items.some((item) => item.per100.source !== 'estimate')) return null;

  return (
    <Text accessibilityLiveRegion="polite" style={[styles.total, { color: theme.text }, theme.font.bodySemiBold]}>
      {t('food.total')} {draft.approximate ? '≈' : ''}{value}
    </Text>
  );
}

const styles = StyleSheet.create({ total: { fontSize: 16, marginBottom: 8 } });
