import { useIsFocused } from '@react-navigation/native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, Text } from 'react-native';

import { DeviceHealthCard } from '@/components/DeviceHealthCard';
import { WorkoutSection } from '@/components/WorkoutSection';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { backfillHealth, syncDayWorkouts } from '@/lib/core/db/healthSync';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { useAppActiveEffect } from '@/lib/core/services/appActive';
import type { WorkoutGrants } from '@/lib/core/services/health';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { localDayKey, parseDayKey } from '@/lib/i18n/formatDay';
import { useTheme } from '@/lib/theme/theme';

export default function WorkoutScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();
  const router = useRouter();
  const { setParams } = router;
  const focused = useIsFocused();
  const { day: dayParam, highlight } = useLocalSearchParams<{ day?: string; highlight?: string }>();
  const today = localDayKey(new Date());
  const parsedDay = typeof dayParam === 'string' ? parseDayKey(dayParam) : null;
  const day = parsedDay && dayParam === localDayKey(parsedDay) && dayParam <= today ? dayParam : today;
  const [highlighted, setHighlighted] = useState<number>();
  const [extendedOn, setExtendedOn] = useState<boolean | null>(null);
  const [grants, setGrants] = useState<WorkoutGrants | null>();
  const [connectedBefore, setConnectedBefore] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recoverInSettings, setRecoverInSettings] = useState(false);
  const requesting = useRef(false);
  const checkVersion = useRef(0);
  const service = getHealthService();
  const android = Platform.OS === 'android';

  useEffect(() => {
    if (!highlight) {
      setHighlighted(undefined);
      return;
    }
    setHighlighted(Number(highlight));
    const timer = setTimeout(() => {
      setHighlighted(undefined);
      setParams({ highlight: '' });
    }, 3800);
    return () => clearTimeout(timer);
  }, [highlight, setParams]);

  const refresh = useCallback(async () => {
    if (!db || requesting.current) return;
    const version = ++checkVersion.current;
    const settings = await ensureSettings(db);
    const current = android ? await service.workoutGrants?.() ?? null : null;
    if (version !== checkVersion.current) return;
    setExtendedOn(settings.healthImportExtended);
    setGrants(current);
    if (current?.exercise) setRecoverInSettings(false);
    setConnectedBefore(settings.healthImportWorkouts || !!current?.exercise);
    if (current?.exercise && !settings.healthImportWorkouts) {
      await updateSettings(db, { healthImportWorkouts: true });
    }
    if (android ? current?.exercise : settings.healthImportExtended) {
      await syncDayWorkouts(db, service, parseDayKey(day) ?? new Date());
      if (version === checkVersion.current) setSyncTick((value) => value + 1);
    }
  }, [android, day, db, service]);

  useFocusEffect(useCallback(() => {
    void refresh().catch(() => {});
    return () => { checkVersion.current++; };
  }, [refresh]));
  useAppActiveEffect(() => {
    if (focused) void refresh().catch(() => {});
  });

  async function connect() {
    if (!db || !service.requestWorkoutPermission || requesting.current) return;
    requesting.current = true;
    checkVersion.current++;
    setBusy(true);
    try {
      await service.requestWorkoutPermission();
      const current = await service.workoutGrants?.() ?? null;
      setGrants(current);
      setRecoverInSettings(connectedBefore && current?.exercise === false);
      if (current?.exercise) {
        await updateSettings(db, { healthImportWorkouts: true });
        setConnectedBefore(true);
        await backfillHealth(db, service, { workoutsOnly: true });
        setSyncTick((value) => value + 1);
      }
    } catch {
      if (connectedBefore) setRecoverInSettings(true);
    } finally {
      requesting.current = false;
      setBusy(false);
    }
  }

  function connectExercise() {
    if (recoverInSettings && service.openHealthSettings) service.openHealthSettings();
    else void connect();
  }

  return (
    <Screen>
      {db ? (
        <>
          <WorkoutSection db={db} initiallyOpen day={day} refreshToken={syncTick}
            highlightedId={highlighted} onDayChange={(day) => setParams({ day, highlight: '' })} />
          {android ? (
            grants?.exercise === false ? (
              <Pressable accessibilityRole="button" disabled={busy} onPress={connectExercise} style={styles.link}>
                <Text style={[{ color: theme.primary }, theme.font.bodySemiBold]}>
                  {t(busy ? 'device.connecting' : connectedBefore ? 'workouts.health.restore' : 'workouts.health.connect')}
                </Text>
              </Pressable>
            ) : grants === null && service.openHealthSettings ? (
              <Pressable accessibilityRole="link" style={styles.link}
                onPress={() => void Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata').catch(() => {})}>
                <Text style={[{ color: theme.primary }, theme.font.bodyMedium]}>{t('device.installAction')}</Text>
              </Pressable>
            ) : null
          ) : extendedOn === false ? (
            <DeviceHealthCard explainer={t('device.workoutExplainer')} onConnected={async () => {
              await backfillHealth(db, service);
              setExtendedOn(true);
              setSyncTick((value) => value + 1);
            }} />
          ) : null}
        </>
      ) : (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.dbUnavailable')}</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18 },
  link: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
});
