import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';

import { SectionCard } from '@/components/SectionCard';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { countDiaryEntries } from '@/lib/core/db/diary';
import { todayMacroTotals, type MacroTotals } from '@/lib/core/db/food';
import { countWins, ensureSettings } from '@/lib/core/db/settings';
import { syncDaySteps } from '@/lib/core/db/steps';
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

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const [tot, settings, diaryN, winsN] = await Promise.all([
          todayMacroTotals(db),
          ensureSettings(db),
          countDiaryEntries(db),
          countWins(db),
        ]);
        const stepCount = await syncDaySteps(db, getHealthService());
        if (!active) return;
        setTotals(tot);
        setTargets({ kcal: settings.targetKcal, proteinG: settings.targetProteinG });
        setHideCalories(settings.hideCalories);
        setSteps(stepCount);
        setStepsMeaning(stepInsight(stepCount, settings.stepsGoal));
        setDiaryCount(diaryN);
        setWinsCount(winsN);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

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
          icon="sparkles-outline"
          title={t('home.sections.diary')}
          subtitle={diaryCount > 0 ? `${t('diary.count')}: ${diaryCount}` : t('diary.cta')}
          theme={theme}
          onPress={() => router.push('/diary')}
        />
        <SectionCard
          icon="trophy-outline"
          title={t('home.sections.wins')}
          subtitle={winsCount > 0 ? `${t('wins.count')}: ${winsCount}` : t('wins.cta')}
          theme={theme}
          onPress={() => router.push('/wins')}
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
});
