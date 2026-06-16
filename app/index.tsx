import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { SectionCard } from '@/components/SectionCard';
import { runAutoWins } from '@/lib/core/db/autoWins';
import { bodyMindInsightFromDb } from '@/lib/core/db/bodyMind';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { countDiaryEntries } from '@/lib/core/db/diary';
import { todayMacroTotals, type MacroTotals } from '@/lib/core/db/food';
import { countWins, ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { syncDaySteps } from '@/lib/core/db/steps';
import { latestWeight } from '@/lib/core/db/weight';
import { type BodyMindResult } from '@/lib/core/insights/bodyMind';
import { stepInsight } from '@/lib/core/insights/stepInsight';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { colors } from '@/lib/theme/colors';

/// Home dashboard. The nutrition card shows today's totals vs targets once the
/// (device-only) database is available; other sections land in later milestones.
export default function HomeScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const router = useRouter();
  const db = useDatabase();

  const [totals, setTotals] = useState<MacroTotals | null>(null);
  const [targets, setTargets] = useState<{ kcal: number; proteinG: number } | null>(null);
  const [hideCalories, setHideCalories] = useState(false);
  const [steps, setSteps] = useState<number | null>(null);
  const [stepsMeaning, setStepsMeaning] = useState<string | null>(null);
  const [diaryCount, setDiaryCount] = useState(0);
  const [winsCount, setWinsCount] = useState(0);
  const [bodyMind, setBodyMind] = useState<BodyMindResult | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const [tot, settings, diaryN, winsN, bodyMindResult, weightRow] = await Promise.all([
          todayMacroTotals(db),
          ensureSettings(db),
          countDiaryEntries(db),
          countWins(db),
          bodyMindInsightFromDb(db),
          latestWeight(db),
        ]);
        const stepCount = await syncDaySteps(db, getHealthService());
        // Celebrate the day's earned goals automatically (deduped per day).
        const awarded = await runAutoWins(
          db,
          {
            steps: stepCount,
            stepsGoal: settings.stepsGoal,
            proteinG: tot.proteinG,
            proteinTargetG: settings.targetProteinG,
            paused: settings.paused,
          },
          {
            stepsGoal: t('wins.auto.stepsGoal', { steps: stepCount }),
            proteinGoal: t('wins.auto.proteinGoal', { protein: Math.round(tot.proteinG) }),
          },
        );
        if (!active) return;
        setTotals(tot);
        setTargets({ kcal: settings.targetKcal, proteinG: settings.targetProteinG });
        setHideCalories(settings.hideCalories);
        setSteps(stepCount);
        setStepsMeaning(stepInsight(stepCount, settings.stepsGoal));
        setDiaryCount(diaryN);
        setWinsCount(winsN + awarded.length);
        setBodyMind(bodyMindResult);
        setWeightKg(weightRow ? weightRow.weightKg : null);
        setPaused(settings.paused);
      })();
      return () => {
        active = false;
      };
    }, [db, t]),
  );

  async function onResume() {
    if (!db) return;
    await updateSettings(db, { paused: false });
    setPaused(false);
  }

  const nutritionSubtitle = (() => {
    if (!totals || !targets) return t('home.comingSoon');
    const protein = `${t('macros.protein')} ${totals.proteinG}/${targets.proteinG} ${t('units.g')}`;
    if (hideCalories) return protein;
    return `${totals.kcal}/${targets.kcal} ${t('units.kcal')} · ${protein}`;
  })();

  const stepsSubtitle =
    steps == null || stepsMeaning == null
      ? t('home.comingSoon')
      : `${steps} ${t('home.steps.unit')}\n${stepsMeaning}`;

  // The mood↔steps card stays hidden until there are enough paired days; below
  // that it would be noise. `null` = don't render the card at all.
  const bodyMindSubtitle = (() => {
    if (!bodyMind || bodyMind.kind === 'insufficient') return null;
    const basis = t('home.bodyMind.basis', { days: bodyMind.pairedDays });
    if (bodyMind.kind === 'no_link') return `${t('bodyMind.noLink')}\n${basis}`;
    const key =
      bodyMind.direction === 'more_steps_better_mood'
        ? 'bodyMind.link.moreStepsBetterMood'
        : 'bodyMind.link.moreStepsWorseMood';
    return `${t(key, { gap: bodyMind.moodGap })}\n${basis}`;
  })();

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/settings')}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingHorizontal: 4 })}
            >
              <Ionicons name="settings-outline" size={22} color={theme.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.greeting, { color: theme.subtle }]}>{t('home.greeting')}</Text>
        {paused ? (
          <View style={[styles.pauseBanner, { backgroundColor: theme.iconBg, borderColor: theme.border }]}>
            <Text style={[styles.pauseTitle, { color: theme.text }]}>{t('home.paused.title')}</Text>
            <Text style={[styles.pauseBody, { color: theme.subtle }]}>{t('home.paused.body')}</Text>
            <Pressable
              onPress={onResume}
              style={({ pressed }) => [styles.pauseBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.pauseBtnText, { color: theme.primary }]}>{t('home.paused.resume')}</Text>
            </Pressable>
          </View>
        ) : null}
        <SectionCard
          icon="restaurant-outline"
          title={t('home.sections.nutrition')}
          subtitle={nutritionSubtitle}
          theme={theme}
          onPress={() => router.push('/food/log')}
        />
        <SectionCard
          icon="walk-outline"
          title={t('home.sections.steps')}
          subtitle={stepsSubtitle}
          theme={theme}
        />
        <SectionCard
          icon="scale-outline"
          title={t('home.sections.weight')}
          subtitle={weightKg != null ? `${weightKg.toFixed(1)} ${t('weight.unit')}` : t('weight.cta')}
          theme={theme}
          onPress={() => router.push('/weight')}
        />
        <SectionCard
          icon="sparkles-outline"
          title={t('home.sections.diary')}
          subtitle={diaryCount > 0 ? `${t('diary.count')}: ${diaryCount}` : t('diary.cta')}
          theme={theme}
          onPress={() => router.push('/diary')}
        />
        {bodyMindSubtitle && (
          <SectionCard
            icon="pulse-outline"
            title={t('home.sections.bodyMind')}
            subtitle={bodyMindSubtitle}
            theme={theme}
          />
        )}
        <SectionCard
          icon="trophy-outline"
          title={t('home.sections.wins')}
          subtitle={winsCount > 0 ? `${t('wins.count')}: ${winsCount}` : t('wins.cta')}
          theme={theme}
          onPress={() => router.push('/wins')}
        />
        <SectionCard
          icon="stats-chart-outline"
          title={t('review.title')}
          subtitle={t('review.homeSubtitle')}
          theme={theme}
          onPress={() => router.push('/review')}
        />
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('home.emptyHint')}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  greeting: { fontSize: 15, marginBottom: 16 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 16 },
  pauseBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  pauseTitle: { fontSize: 16, fontWeight: '600' },
  pauseBody: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  pauseBtn: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 12,
  },
  pauseBtnText: { fontSize: 14, fontWeight: '600' },
});
