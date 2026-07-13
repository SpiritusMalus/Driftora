import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { StepsRow } from '@/lib/core/db/schema';
import { listStepsDays, setManualSteps, syncDaySteps } from '@/lib/core/db/steps';
import { useAppActiveEffect } from '@/lib/core/services/appActive';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { useTheme } from '@/lib/theme/theme';

type HealthState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'denied'
  | 'unavailable'
  | 'update_required'
  | 'unsupported';

/// Health Connect's package on Google Play — used to send the user to install or
/// update the provider when `availability()` reports it's missing/outdated.
const HEALTH_CONNECT_PKG = 'com.google.android.apps.healthdata';

/// «Шаги» — the step count that feeds the day budget: typed by hand or read
/// from the OS health store, plus the recent history and the Health Connect
/// hookup. Workouts used to share this screen but now live on their own
/// «Тренировки» screen («из шагов убрать раздел тренировки», device feedback
/// 2026-07-12). A manual steps entry is sticky — the passive OS sync never
/// overwrites it (source 'manual'), so a typed number is never silently replaced.
export default function ActivityScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<StepsRow[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<HealthState>('idle');

  // Pull today's device count BEFORE listing, so the history's top row is the
  // live number, not whatever some earlier screen happened to store (a manual
  // entry stays sticky inside syncDaySteps).
  const reloadSteps = useCallback(async () => {
    if (!db) return null;
    await syncDaySteps(db, getHealthService());
    return listStepsDays(db, 30);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void reloadSteps().then((list) => {
        if (active && list) setItems(list);
      });
      return () => {
        active = false;
      };
    }, [reloadSteps]),
  );

  // Re-sync on returning from the background too — the OS count keeps moving
  // while the app sleeps.
  useAppActiveEffect(() => {
    void reloadSteps().then((list) => {
      if (list) setItems(list);
    });
  });

  async function onSave() {
    const steps = toSteps(text);
    if (!db || steps < 0) return;
    setSaving(true);
    try {
      await setManualSteps(db, new Date(), steps);
      setText('');
      setItems(await listStepsDays(db, 30));
    } finally {
      setSaving(false);
    }
  }

  /// Ask the OS health store for read permission. On grant, immediately pull
  /// today's count (device reads never overwrite a 'manual' day — see
  /// syncDaySteps) and refresh the list. Failures degrade honestly to a status
  /// line; manual entry always remains available.
  async function onConnectHealth() {
    if (!db || health === 'connecting') return;
    setHealth('connecting');
    try {
      const svc = getHealthService();
      // Probe the provider FIRST. Without this, a missing/outdated Health Connect
      // makes requestPermissions a silent no-op (the app never even asks) — the
      // exact "nothing opens" symptom. Now we report why and offer a fix.
      const avail = svc.availability ? await svc.availability() : 'available';
      if (avail !== 'available') {
        setHealth(avail);
        return;
      }
      const granted = await svc.requestPermissions();
      if (!granted) {
        setHealth('denied');
        return;
      }
      const list = await reloadSteps();
      if (list) setItems(list);
      setHealth('connected');
    } catch {
      setHealth('unavailable');
    }
  }

  /// Send the user to Health Connect on Google Play (install or update). Falls
  /// back to the https listing if the Play Store app can't handle the market URI.
  async function onOpenHealthConnectStore() {
    const market = `market://details?id=${HEALTH_CONNECT_PKG}`;
    const web = `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PKG}`;
    try {
      if (await Linking.canOpenURL(market)) await Linking.openURL(market);
      else await Linking.openURL(web);
    } catch {
      await Linking.openURL(web).catch(() => {});
    }
  }

  const valid = toSteps(text) >= 0 && text.trim().length > 0;

  const rows: RowSpec[] = (items ?? []).map((s) => ({
    key: s.date,
    title: formatDay(s.date),
    subtitle: s.source === 'manual' ? t('steps.source.manual') : t('steps.source.device'),
    right: (
      <Text style={[styles.rowSteps, { color: theme.text }, theme.font.bodySemiBold]}>
        {formatStepCount(s.steps)}
      </Text>
    ),
  }));

  return (
    <Screen>
      <SectionHeader>{t('activity.stepsSection')}</SectionHeader>
      <View style={styles.inputRow}>
        <TextField
          value={text}
          onChangeText={setText}
          placeholder={t('steps.placeholder')}
          keyboardType="number-pad"
          style={styles.input}
        />
        <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('steps.unit')}</Text>
      </View>
      <PrimaryButton
        label={saving ? t('steps.saving') : t('steps.save')}
        onPress={onSave}
        disabled={db == null || !valid || saving}
        style={styles.save}
      />

      <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('steps.note')}</Text>

      <SectionHeader>{t('steps.auto.title')}</SectionHeader>
      <Card style={styles.autoCard}>
        <Text style={[styles.autoExplainer, { color: theme.subtle }, theme.font.body]}>
          {t('steps.auto.explainer')}
        </Text>
        <PrimaryButton
          label={health === 'connecting' ? t('steps.auto.connecting') : t('steps.auto.connect')}
          onPress={onConnectHealth}
          disabled={db == null || health === 'connecting'}
          style={styles.autoBtn}
        />
        {health !== 'idle' && health !== 'connecting' ? (
          <Text style={[styles.autoStatus, { color: theme.subtle }, theme.font.body]}>
            {t(`steps.auto.${health}`)}
          </Text>
        ) : null}
        {/* When the provider is missing/outdated, give the user a way out:
            install or update Health Connect on Google Play (Android only). */}
        {Platform.OS === 'android' && (health === 'update_required' || health === 'unavailable') ? (
          <Pressable onPress={onOpenHealthConnectStore} hitSlop={8} style={styles.installRow}>
            <Text style={[styles.installLink, { color: theme.primary }, theme.font.bodySemiBold]}>
              {t('steps.auto.installAction')}
            </Text>
          </Pressable>
        ) : null}
      </Card>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.empty')}</Text>
      ) : (
        <View style={styles.history}>
          <SectionHeader>{t('activity.historySection')}</SectionHeader>
          <ListGroup rows={rows} />
        </View>
      )}
    </Screen>
  );
}

/// Whole non-negative step count, or -1 for invalid input.
function toSteps(v: string): number {
  const n = parseInt(v.replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

/// '2026-06-17' → '17.06.2026'.
function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/// Group thousands using the locale separator: 8400 → '8 400'.
function formatStepCount(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}


const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 12 },
  input: { flex: 1 },
  unit: { fontSize: 15 },
  save: { marginBottom: 16 },
  note: { fontSize: 12, lineHeight: 17, marginHorizontal: 4, marginBottom: 16 },
  autoCard: { marginTop: 4 },
  autoExplainer: { fontSize: 13, lineHeight: 19 },
  autoBtn: { marginTop: 12 },
  autoStatus: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  installRow: { marginTop: 10, paddingVertical: 4 },
  installLink: { fontSize: 14, textDecorationLine: 'underline' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  history: { marginTop: 4 },
  rowSteps: { fontSize: 16 },
});
