import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listDistortionTagsSince } from '@/lib/core/db/diary';
import { ensureSettings } from '@/lib/core/db/settings';
import { weekReview, type WeekReview } from '@/lib/core/db/weekReview';
import { thinkingTrapOfWeek, type ThinkingTrap } from '@/lib/core/insights/distortions';
import { stepReference } from '@/lib/core/insights/stepNorms';
import { colors, type ThemeColors } from '@/lib/theme/colors';
import { fonts } from '@/lib/theme/typography';

/// Offline weekly review — this week vs your past self, plus the streak,
/// north-star and thinking trap. No population comparison, no weight pressure.
export default function ReviewScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const db = useDatabase();

  const [review, setReview] = useState<WeekReview | null>(null);
  const [hideCalories, setHideCalories] = useState(false);
  const [showPopulationStats, setShowPopulationStats] = useState(false);
  const [trap, setTrap] = useState<ThinkingTrap | null>(null);

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
        <Text style={{ color: theme.subtle }}>{t('review.dbUnavailable')}</Text>
      </View>
    );
  }
  if (review == null) return <View style={{ flex: 1, backgroundColor: theme.background }} />;

  const a = review.thisWeek;
  const b = review.lastWeek;
  const metrics: { label: string; value: number; delta: number; unit?: string }[] = [
    { label: t('review.metrics.steps'), value: a.stepsAvg, delta: a.stepsAvg - b.stepsAvg },
    { label: t('review.metrics.protein'), value: a.proteinAvg, delta: a.proteinAvg - b.proteinAvg, unit: t('units.g') },
    ...(hideCalories
      ? []
      : [{ label: t('review.metrics.kcal'), value: a.kcalAvg, delta: a.kcalAvg - b.kcalAvg, unit: t('units.kcal') }]),
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

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={[styles.summary, { backgroundColor: theme.iconBg, borderColor: theme.border }]}>
        <Text style={[styles.summaryMain, { color: theme.text }]}>
          {t('review.northStar', { days: review.northStarThisWeek })}
        </Text>
        {review.streakWeeks > 0 ? (
          <Text style={[styles.summarySub, { color: theme.subtle }]}>
            {t('review.streak', { weeks: review.streakWeeks })}
          </Text>
        ) : null}
        <Text style={[styles.reassurance, { color: theme.subtle }]}>{t('review.reassurance')}</Text>
      </View>

      <Text style={[styles.section, { color: theme.subtle }]}>{t('review.vsLastWeek')}</Text>
      {metrics.map((m) => (
        <View key={m.label} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.rowLabel, { color: theme.text }]}>{m.label}</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.rowValue, { color: theme.text }]}>
              {m.value}
              {m.unit ? ` ${m.unit}` : ''}
            </Text>
            <Text style={[styles.rowDelta, { color: theme.subtle }]}>{formatDelta(m.delta, t)}</Text>
          </View>
        </View>
      ))}

      {normsLine ? (
        <View style={[styles.normsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.normsTitle, { color: theme.subtle }]}>{t('review.norms.title')}</Text>
          <Text style={[styles.normsBody, { color: theme.text }]}>{normsLine}</Text>
          <Text style={[styles.normsSource, { color: theme.subtle }]}>{t('review.norms.source')}</Text>
        </View>
      ) : null}

      {trap ? (
        <View style={[styles.trapCard, { backgroundColor: theme.iconBg, borderColor: theme.border }]}>
          <Text style={[styles.trapTitle, { color: theme.text }]}>{t('diary.trap.title')}</Text>
          <Text style={[styles.trapBody, { color: theme.subtle }]}>
            {t('diary.trap.body', { name: t(`diary.distortions.${trap.key}`), count: trap.count })}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function formatDelta(delta: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (delta === 0) return t('review.deltaSame');
  const sign = delta > 0 ? '+' : '−';
  return t('review.delta', { change: `${sign}${Math.abs(delta)}` });
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  summary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  summaryMain: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 25, letterSpacing: -0.3 },
  summarySub: { fontFamily: fonts.bodyMedium, fontSize: 14, marginTop: 8 },
  reassurance: { fontFamily: fonts.body, fontSize: 12, marginTop: 10, lineHeight: 17 },
  section: { fontFamily: fonts.heading, fontSize: 11, letterSpacing: 1.2, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 8,
  },
  rowLabel: { fontFamily: fonts.body, fontSize: 15, flex: 1, paddingRight: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  rowDelta: { fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  normsCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
  },
  normsTitle: { fontFamily: fonts.heading, fontSize: 11, letterSpacing: 1.2 },
  normsBody: { fontFamily: fonts.body, fontSize: 14, marginTop: 8, lineHeight: 20 },
  normsSource: { fontFamily: fonts.body, fontSize: 11, marginTop: 8, fontStyle: 'italic', lineHeight: 16 },
  trapCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
  },
  trapTitle: { fontFamily: fonts.bodySemiBold, fontSize: 14 },
  trapBody: { fontFamily: fonts.body, fontSize: 13, marginTop: 4, lineHeight: 18 },
});
