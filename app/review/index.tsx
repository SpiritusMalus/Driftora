import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listDistortionTagsSince } from '@/lib/core/db/diary';
import { ensureSettings } from '@/lib/core/db/settings';
import { weekReview, type WeekReview } from '@/lib/core/db/weekReview';
import { thinkingTrapOfWeek, type ThinkingTrap } from '@/lib/core/insights/distortions';
import { colors, type ThemeColors } from '@/lib/theme/colors';

/// Offline weekly review — this week vs your past self, plus the streak,
/// north-star and thinking trap. No population comparison, no weight pressure.
export default function ReviewScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const db = useDatabase();

  const [review, setReview] = useState<WeekReview | null>(null);
  const [hideCalories, setHideCalories] = useState(false);
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
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  summaryMain: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  summarySub: { fontSize: 14, marginTop: 6 },
  reassurance: { fontSize: 12, marginTop: 10, lineHeight: 17 },
  section: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  rowLabel: { fontSize: 15, flex: 1, paddingRight: 12 },
  rowRight: { alignItems: 'flex-end' },
  rowValue: { fontSize: 16, fontWeight: '600' },
  rowDelta: { fontSize: 12, marginTop: 2 },
  trapCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  trapTitle: { fontSize: 14, fontWeight: '600' },
  trapBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
});
