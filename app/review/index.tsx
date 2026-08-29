import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listDistortionTagsSince } from '@/lib/core/db/diary';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { weekReview, type WeekReview } from '@/lib/core/db/weekReview';
import { thinkingTrapOfWeek, type ThinkingTrap } from '@/lib/core/insights/distortions';
import { pluralKey } from '@/lib/i18n/plural';
import { stepReference } from '@/lib/core/insights/stepNorms';
import { useTheme } from '@/lib/theme/theme';

/// Offline weekly review — this week vs your past self, plus the streak,
/// north-star and thinking trap. No population comparison, no weight pressure.
export default function ReviewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [review, setReview] = useState<WeekReview | null>(null);
  const [hideCalories, setHideCalories] = useState(false);
  const [showPopulationStats, setShowPopulationStats] = useState(false);
  const [trap, setTrap] = useState<ThinkingTrap | null>(null);
  const [restarted, setRestarted] = useState<Date | null>(null);

  /// «Начать заново»: move the streak's floor to now. Confirmed first — the
  /// number it resets is the one thing on this screen people are proud of.
  ///
  /// Nothing is deleted. Every logged day, meal and workout stays; only the
  /// consecutive-weeks tally starts from today. The dialog says so, because
  /// «начать заново» in a fitness app usually means «сотри всё», and a person
  /// tapping it deserves to know which one this is BEFORE they tap.
  function onRestartStreak() {
    Alert.alert(t('review.restart.title'), t('review.restart.body'), [
      { text: t('review.restart.cancel'), style: 'cancel' },
      {
        text: t('review.restart.confirm'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!db) return;
            const now = new Date();
            await updateSettings(db, { streakRestartedAt: now });
            setRestarted(now);
            setReview((prev) => (prev ? { ...prev, streakWeeks: 0 } : prev));
          })();
        },
      },
    ]);
  }

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const [rev, settings, tagLists] = await Promise.all([
          weekReview(db),
          ensureSettings(db),
          listDistortionTagsSince(db, weekAgo),
        ]);
        if (!active) return;
        setReview(rev);
        setHideCalories(settings.hideCalories);
        setRestarted(settings.streakRestartedAt ?? null);
        setShowPopulationStats(settings.showPopulationStats);
        setTrap(thinkingTrapOfWeek(tagLists));
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  if (db == null) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.background }]}>
        <Text style={[{ color: theme.subtle }, theme.font.body]}>{t('review.dbUnavailable')}</Text>
      </View>
    );
  }
  if (review == null) return <View style={{ flex: 1, backgroundColor: theme.background }} />;

  const a = review.thisWeek;
  const b = review.lastWeek;
  type Metric = { label: string; value: number; delta: number; unit?: string };
  // Two honest groups: per-day averages vs. weekly totals. Splitting them lets
  // the labels drop the repeated "(avg/day)" qualifier without blurring units.
  const avgMetrics: Metric[] = [
    { label: t('review.metrics.steps'), value: a.stepsAvg, delta: a.stepsAvg - b.stepsAvg },
    // Movement rides together: minutes averaged over the days that HAD a
    // workout (a rest day is not a zero — see [WeekStats]), so the number
    // answers «сколько обычно длилась тренировка», not «сколько в сутках».
    {
      label: t('review.metrics.workoutTime'),
      value: a.workoutMinutesAvg,
      delta: a.workoutMinutesAvg - b.workoutMinutesAvg,
      unit: t('workouts.min'),
    },
    { label: t('review.metrics.protein'), value: a.proteinAvg, delta: a.proteinAvg - b.proteinAvg, unit: t('units.g') },
    // Fiber rides beside protein, not behind hideCalories: it is the science
    // push's flagship number (#213) and carries no calorie pressure.
    { label: t('review.metrics.fiber'), value: a.fiberAvg, delta: a.fiberAvg - b.fiberAvg, unit: t('units.g') },
    ...(hideCalories
      ? []
      : [
          { label: t('review.metrics.kcal'), value: a.kcalAvg, delta: a.kcalAvg - b.kcalAvg, unit: t('units.kcal') },
          // «Недоел или переел» — то, чего в статистике не было совсем: средние
          // ккал показывались без нормы, с которой их сравнить. Строка есть
          // только когда норму МОЖНО посчитать (есть цель, профиль и вес).
          ...(a.kcalBalanceAvg == null
            ? []
            : [
                {
                  label: t('review.metrics.balance'),
                  value: a.kcalBalanceAvg,
                  delta:
                    b.kcalBalanceAvg == null ? 0 : a.kcalBalanceAvg - b.kcalBalanceAvg,
                  unit: t('units.kcal'),
                },
              ]),
        ]),
  ];
  const totalMetrics: Metric[] = [
    // Kept a plain count, never the burned kcal: the weekly review is the one
    // screen with no calorie pressure on it, and «сколько раз» is the honest
    // answer to «тренировался ли я на этой неделе».
    { label: t('review.metrics.workouts'), value: a.workoutCount, delta: a.workoutCount - b.workoutCount },
    { label: t('review.metrics.foodDays'), value: a.foodLogDays, delta: a.foodLogDays - b.foodLogDays },
    { label: t('review.metrics.diary'), value: a.diaryCount, delta: a.diaryCount - b.diaryCount },
    { label: t('review.metrics.wins'), value: a.winsCount, delta: a.winsCount - b.winsCount },
  ];

  // Opt-in honest comparison: the user's step average vs sourced reference
  // points (not a peer leaderboard).
  const ref = showPopulationStats ? stepReference(a.stepsAvg) : null;
  const normsLine = (() => {
    if (!ref) return null;
    switch (ref.standing) {
      case 'building':
        return t('review.norms.building', { avg: ref.weeklyAvg, gap: ref.gapToBeneficial });
      case 'approaching':
        return t('review.norms.approaching', { avg: ref.weeklyAvg, gap: ref.gapToBeneficial });
      case 'beneficial':
        return t('review.norms.beneficial', { avg: ref.weeklyAvg });
      case 'ample':
        return t('review.norms.ample', { avg: ref.weeklyAvg });
    }
  })();

  const toRows = (metrics: Metric[]): RowSpec[] =>
    metrics.map((m) => ({
      key: m.label,
      title: m.label,
      right: (
        <View style={styles.rowRight}>
          <Text style={[styles.rowValue, { color: theme.text }, theme.font.bodySemiBold]}>
            {m.value}
            {m.unit ? ` ${m.unit}` : ''}
          </Text>
          <Text style={[styles.rowDelta, { color: theme.subtle }, theme.font.body]}>
            {formatDelta(m.delta, t)}
          </Text>
        </View>
      ),
    }));

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
          {t('review.totalLabel').toUpperCase()}
        </Text>
        <View style={styles.heroRow}>
          <Text style={[styles.heroNum, { color: theme.heroAccent }, theme.font.heading]}>
            {review.northStarThisWeek}
          </Text>
          {review.streakWeeks > 0 ? (
            <Text style={[styles.heroStreak, { color: theme.subtle }, theme.font.bodyMedium]}>
              {t('review.streak', {
                weeks: review.streakWeeks,
                weeksWord: t(pluralKey('week.unit', review.streakWeeks)),
              })}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.reassurance, { color: theme.subtle }, theme.font.body]}>
          {t('review.reassurance')}
        </Text>
      </View>

      <Text style={[styles.deltaCaption, { color: theme.subtle }, theme.font.body]}>
        {t('review.deltaCaption')}
      </Text>

      <SectionHeader>{t('review.avgSection')}</SectionHeader>
      <ListGroup rows={toRows(avgMetrics)} />

      <SectionHeader>{t('review.totalSection')}</SectionHeader>
      <ListGroup rows={toRows(totalMetrics)} />

      {normsLine ? (
        <>
          <SectionHeader>{t('review.norms.title')}</SectionHeader>
          <Card style={styles.card}>
            <Text style={[styles.normsBody, { color: theme.text }, theme.font.body]}>{normsLine}</Text>
            <Text style={[styles.normsSource, { color: theme.subtle }, theme.font.body]}>
              {t('review.norms.source')}
            </Text>
          </Card>
        </>
      ) : null}

      {trap ? (
        <Card style={[styles.card, { backgroundColor: theme.iconBg, borderColor: theme.cardBorder }]}>
          <Text style={[styles.trapTitle, { color: theme.text }, theme.font.bodySemiBold]}>
            {t('diary.trap.title')}
          </Text>
          <Text style={[styles.trapBody, { color: theme.subtle }, theme.font.body]}>
            {t('diary.trap.body', { name: t(`diary.distortions.${trap.key}`), count: trap.count })}
          </Text>
        </Card>
      ) : null}

      {/* Quiet, at the bottom, never beside the number it resets — an action
          that zeroes a streak must not sit within a thumb's slip of the hero. */}
      <Pressable onPress={onRestartStreak} style={styles.restartBtn} accessibilityRole="button">
        <Text style={[styles.restartText, { color: theme.subtle }, theme.font.body]}>
          {t('review.restart.action')}
        </Text>
      </Pressable>
      {restarted != null ? (
        <Text style={[styles.restartNote, { color: theme.tertiary }, theme.font.body]}>
          {t('review.restart.since', { date: restarted.toLocaleDateString() })}
        </Text>
      ) : null}
    </Screen>
  );
}

function formatDelta(delta: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (delta === 0) return t('review.deltaSame');
  const sign = delta > 0 ? '+' : '−';
  return t('review.delta', { change: `${sign}${Math.abs(delta)}` });
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  // Hero — north-star log-days big (coral, the reward), streak riding beside it
  // (mirrors the Wins hero). Bare on the page, no tinted card.
  hero: { marginTop: 8, marginBottom: 4 },
  heroLabel: { fontSize: 12, letterSpacing: 1.44, marginBottom: 4 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  heroNum: { fontSize: 40, lineHeight: 44 },
  heroStreak: { fontSize: 14, lineHeight: 19 },
  reassurance: { fontSize: 12, marginTop: 10, lineHeight: 17 },
  restartBtn: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 16, marginTop: 24 },
  restartText: { fontSize: 13 },
  restartNote: { fontSize: 12, textAlign: 'center', marginTop: -6 },
  deltaCaption: { fontSize: 12, marginTop: 14, lineHeight: 16 },
  card: { marginTop: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { fontSize: 16 },
  rowDelta: { fontSize: 12, marginTop: 2 },
  normsBody: { fontSize: 14, lineHeight: 20 },
  normsSource: { fontSize: 11, marginTop: 8, fontStyle: 'italic', lineHeight: 16 },
  trapTitle: { fontSize: 14 },
  trapBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
});
