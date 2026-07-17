import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { DeviceHealthCard } from '@/components/DeviceHealthCard';
import { WorkoutSection } from '@/components/WorkoutSection';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { backfillHealth, syncDayWorkouts } from '@/lib/core/db/healthSync';
import { ensureSettings } from '@/lib/core/db/settings';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { useTheme } from '@/lib/theme/theme';

/// «Тренировки» — the workout log on its own screen, split out from «Шаги»
/// («из тренировок убрать шаги сегодня», device feedback 2026-07-12). The card
/// carries its own title and arrives unfolded (this screen exists only to log a
/// workout). Watch sessions import here too: the connect card (until the
/// extended import is on) and a passive today-sync on focus.
export default function WorkoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [extendedOn, setExtendedOn] = useState<boolean | null>(null);
  // Remount key for WorkoutSection — it loads its own list on focus, so a
  // finished backfill/sync needs a nudge to show the imported rows.
  const [syncTick, setSyncTick] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const s = await ensureSettings(db);
        if (!active) return;
        setExtendedOn(s.healthImportExtended);
        if (s.healthImportExtended) {
          // Pull today's watch sessions before the list renders stale.
          await syncDayWorkouts(db, getHealthService()).catch(() => {});
          if (active) setSyncTick((v) => v + 1);
        }
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  return (
    <Screen>
      {db != null ? (
        <>
          {extendedOn === false ? (
            <DeviceHealthCard
              explainer={t('device.workoutExplainer')}
              onConnected={async () => {
                await backfillHealth(db, getHealthService()).catch(() => {});
                setExtendedOn(true);
                setSyncTick((v) => v + 1);
              }}
            />
          ) : null}
          <WorkoutSection key={syncTick} db={db} initiallyOpen />
        </>
      ) : (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.dbUnavailable')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
});
