import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { WorkoutSection } from '@/components/WorkoutSection';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { useTheme } from '@/lib/theme/theme';

/// «Тренировки» — the workout log on its own screen, split out from «Шаги»
/// («из тренировок убрать шаги сегодня», device feedback 2026-07-12). The card
/// carries its own title and arrives unfolded (this screen exists only to log a
/// workout), so there is nothing else to show here.
export default function WorkoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  return (
    <Screen>
      {db != null ? (
        <WorkoutSection db={db} initiallyOpen />
      ) : (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.dbUnavailable')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
});
