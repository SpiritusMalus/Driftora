import { Ionicons } from '@expo/vector-icons';
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
import type { StepsRow, WeightRow } from '@/lib/core/db/schema';
import { dayKey, listStepsDays, setManualSteps, syncDaySteps } from '@/lib/core/db/steps';
import { latestWeight } from '@/lib/core/db/weight';
import { stepsEarnedKcal } from '@/lib/core/insights/bodyMetrics';
import { useAppActiveEffect } from '@/lib/core/services/appActive';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { pluralKey } from '@/lib/i18n/plural';
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

/// «Шаги» — the step count that feeds the day budget. The screen now LEADS with
/// today's count as a hero (plus the honest «шаги → бюджет» payoff line), keeps
/// the automatic Health Connect hookup as the primary path, and folds the manual
/// entry away as a fallback (a manual number is sticky — the passive OS sync
/// never overwrites it, source 'manual'). Below is the recent history. Workouts
/// used to share this screen but now live on their own «Тренировки» screen («из
/// шагов убрать раздел тренировки», device feedback 2026-07-12).
export default function ActivityScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<StepsRow[] | null>(null);
  const [weight, setWeight] = useState<WeightRow | null>(null);
  const [text, setText] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<HealthState>('idle');

  // Pull today's device count BEFORE listing, so the hero and the history's top
  // row are the live number, not whatever some earlier screen happened to store
  // (a manual entry stays sticky inside syncDaySteps).
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
      // The latest weight lets us turn today's steps into an honest «≈ N ккал»
      // payoff (same base+earned model as Home). Missing weight simply hides it.
      if (db) void latestWeight(db).then((w) => active && setWeight(w));
      return () => {
        active = false;
      };
    }, [reloadSteps, db]),
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
      setManualOpen(false);
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

  // Today's row (if any) drives the hero; the history below shows the PAST days
  // only, so the day's number isn't printed twice.
  const todayKey = dayKey();
  const today = (items ?? []).find((s) => s.date === todayKey) ?? null;
  const history = (items ?? []).filter((s) => s.date !== todayKey);

  // Honest «шаги → бюджет» payoff, only once a weight is known: real earned kcal
  // above the resting baseline, or a note that the first ~3000 are already in the
  // base (so a small count reading as "did nothing" is explained, not hidden).
  const earnedKcal =
    today != null && weight != null ? stepsEarnedKcal(today.steps, weight.weightKg) : 0;
  const payoffLine =
    today == null
      ? null
      : earnedKcal > 0
        ? t('activity.earned', { kcal: earnedKcal })
        : today.steps > 0
          ? t('activity.inBase')
          : null;

  // Auto counting is "working" either after connecting this session, or whenever
  // today's number came from the device — collapse the setup card to a quiet line.
  const autoWorking = health === 'connected' || today?.source === 'device';

  const rows: RowSpec[] = history.map((s) => ({
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
      {/* HERO — today's steps, big; the number is the point of the screen. */}
      <View style={styles.hero}>
        {today != null ? (
          <>
            <View style={styles.heroRow}>
              <Text style={[styles.heroNum, { color: theme.text }, theme.font.heading]}>
                {formatStepCount(today.steps)}
              </Text>
              <Text style={[styles.heroLabel, { color: theme.subtle }, theme.font.body]}>
                {t(pluralKey('activity.today', today.steps))}
              </Text>
            </View>
            {payoffLine ? (
              <Text style={[styles.heroPayoff, { color: theme.subtle }, theme.font.body]}>
                {payoffLine}
              </Text>
            ) : null}
            <Text style={[styles.heroSource, { color: theme.tertiary }, theme.font.body]}>
              {today.source === 'manual' ? t('steps.source.manual') : t('steps.source.device')}
            </Text>
          </>
        ) : (
          <Text style={[styles.heroEmpty, { color: theme.subtle }, theme.font.body]}>
            {t('activity.noneToday')}
          </Text>
        )}
      </View>

      {/* AUTOMATIC COUNT — the primary path. Collapses to a quiet line once it
          works; shows the full setup (explainer + connect + degraded states)
          only while it isn't connected yet. */}
      {autoWorking ? (
        <View style={styles.autoDoneRow}>
          <Ionicons name="checkmark-circle" size={16} color={theme.primary} />
          <Text style={[styles.autoDoneText, { color: theme.subtle }, theme.font.body]}>
            {t('activity.autoConnected')}
          </Text>
        </View>
      ) : (
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
      )}

      {/* MANUAL — folded fallback (typing a number from another tracker). */}
      <Pressable
        onPress={() => setManualOpen((v) => !v)}
        hitSlop={6}
        accessibilityRole="button"
        style={({ pressed }) => [styles.manualToggle, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name={manualOpen ? 'remove' : 'add'} size={16} color={theme.primary} />
        <Text style={[styles.manualToggleText, { color: theme.primary }, theme.font.bodySemiBold]}>
          {t('activity.manualAdd')}
        </Text>
      </Pressable>
      {manualOpen ? (
        <View style={styles.manualBody}>
          <View style={styles.inputRow}>
            <TextField
              value={text}
              onChangeText={setText}
              placeholder={t('steps.placeholder')}
              keyboardType="number-pad"
              autoFocus
              style={styles.input}
            />
            <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>
              {t('steps.unit')}
            </Text>
          </View>
          <PrimaryButton
            label={saving ? t('steps.saving') : t('steps.save')}
            onPress={onSave}
            disabled={db == null || !valid || saving}
            style={styles.save}
          />
          <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
            {t('steps.note')}
          </Text>
        </View>
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
          {t('steps.dbUnavailable')}
        </Text>
      ) : items == null ? null : history.length === 0 ? (
        today == null ? (
          <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
            {t('steps.empty')}
          </Text>
        ) : null
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
  hero: { marginTop: 8, marginBottom: 20 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heroNum: { fontSize: 40, lineHeight: 44 },
  heroLabel: { fontSize: 15 },
  heroPayoff: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  heroSource: { fontSize: 12, marginTop: 4 },
  heroEmpty: { fontSize: 15, lineHeight: 21 },

  autoCard: { marginTop: 4 },
  autoExplainer: { fontSize: 13, lineHeight: 19 },
  autoBtn: { marginTop: 12 },
  autoStatus: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  installRow: { marginTop: 10, paddingVertical: 4 },
  installLink: { fontSize: 14, textDecorationLine: 'underline' },
  autoDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  autoDoneText: { fontSize: 13, lineHeight: 19, flex: 1 },

  manualToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, paddingVertical: 4 },
  manualToggleText: { fontSize: 15 },
  manualBody: { marginTop: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  input: { flex: 1 },
  unit: { fontSize: 15 },
  save: { marginBottom: 12 },
  note: { fontSize: 12, lineHeight: 17, marginHorizontal: 4 },

  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  history: { marginTop: 8 },
  rowSteps: { fontSize: 16 },
});
