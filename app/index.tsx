import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BodyMindCard } from '@/components/ui/BodyMindCard';
import { Card } from '@/components/ui/Card';
import { FoodBar } from '@/components/ui/FoodBar';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { MoodScale } from '@/components/ui/MoodScale';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { runAutoWins } from '@/lib/core/db/autoWins';
import { bodyMindInsightFromDb } from '@/lib/core/db/bodyMind';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { countDiaryEntries } from '@/lib/core/db/diary';
import { todayMacroTotals } from '@/lib/core/db/food';
import { latestMood, logMood } from '@/lib/core/db/mood';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { syncDaySteps } from '@/lib/core/db/steps';
import { weekReview } from '@/lib/core/db/weekReview';
import { MIN_PAIRED_DAYS, type BodyMindResult } from '@/lib/core/insights/bodyMind';
import { stepInsight } from '@/lib/core/insights/stepInsight';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { useTheme } from '@/lib/theme/theme';

/// Home is a single-insight surface, not a dashboard. The Body↔Mind read
/// (movement ↔ mood) is the editorial hero card at the top; beneath it sit only
/// the inputs that *feed* that insight — a one-tap mood scale, today's steps, the
/// diary — plus a pinned food bar. Everything else lives behind "More". The
/// hero's honesty states are preserved exactly: a building-up placeholder below
/// the paired-days gate, an honest "no clear link yet", and the "association,
/// not cause" framing on real findings.
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const insets = useSafeAreaInsets();

  const [steps, setSteps] = useState<number | null>(null);
  const [stepsMeaning, setStepsMeaning] = useState<string | null>(null);
  const [diaryCount, setDiaryCount] = useState(0);
  const [bodyMind, setBodyMind] = useState<BodyMindResult | null>(null);
  const [moodValue, setMoodValue] = useState<number | null>(null);
  const [streakWeeks, setStreakWeeks] = useState(0);
  const [paused, setPaused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const [tot, settings, diaryN, bodyMindResult, moodRow, review] = await Promise.all([
          todayMacroTotals(db),
          ensureSettings(db),
          countDiaryEntries(db),
          bodyMindInsightFromDb(db),
          latestMood(db),
          weekReview(db),
        ]);
        const stepCount = await syncDaySteps(db, getHealthService());
        // Celebrate the day's earned goals automatically (deduped per day). A
        // quiet background behavior, not a Home card — kept as-is.
        await runAutoWins(
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
        setSteps(stepCount);
        setStepsMeaning(stepInsight(stepCount, settings.stepsGoal));
        setDiaryCount(diaryN);
        setBodyMind(bodyMindResult);
        setMoodValue(moodRow ? moodRow.value : null);
        setStreakWeeks(review.streakWeeks);
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

  // One-tap mood check-in straight from Home — the lowest-friction feeder.
  async function onPickMood(value: number) {
    if (!db) return;
    await logMood(db, value);
    setMoodValue(value);
  }

  // Map the structured Body↔Mind result onto the presentational hero. Every
  // honesty state is preserved: building placeholder below the gate, an honest
  // no-link line, and the "association, not cause" caption on real findings.
  const hero = ((): {
    eyebrow: string;
    accent?: string;
    headline: string;
    basis?: string;
    caption?: string;
  } => {
    const eyebrow = t('home.hero.eyebrow');
    if (!bodyMind || bodyMind.kind === 'insufficient') {
      const remaining = Math.max(1, MIN_PAIRED_DAYS - (bodyMind?.pairedDays ?? 0));
      return {
        eyebrow,
        headline: t(buildingKey(remaining), { days: remaining }),
        caption: t('home.hero.buildingCaption'),
      };
    }
    const basis = t('home.bodyMind.basis', { days: bodyMind.pairedDays });
    if (bodyMind.kind === 'no_link') {
      return { eyebrow, headline: t('bodyMind.hero.noLink'), basis, caption: t('home.hero.caption') };
    }
    const headlineKey =
      bodyMind.direction === 'more_steps_better_mood'
        ? 'bodyMind.hero.moreStepsBetterMood'
        : 'bodyMind.hero.moreStepsWorseMood';
    return {
      eyebrow,
      accent: t('bodyMind.hero.accent', { gap: bodyMind.moodGap }),
      headline: t(headlineKey, { gap: bodyMind.moodGap }),
      basis,
      caption: t('home.hero.caption'),
    };
  })();

  const stepsSubtitle =
    steps == null || stepsMeaning == null
      ? t('home.comingSoon')
      : `${formatSteps(steps)} — ${stepsMeaning}`;

  const feeders: RowSpec[] = [
    {
      key: 'steps',
      icon: 'walk-outline',
      tint: theme.accent,
      iconBg: theme.scheme === 'light' ? '#FBEFD9' : '#33261F',
      title: t('home.feeders.steps'),
      subtitle: stepsSubtitle,
    },
    {
      key: 'diary',
      icon: 'sparkles-outline',
      tint: theme.primary,
      iconBg: theme.scheme === 'light' ? '#FBE2D9' : '#3A241B',
      title: t('home.feeders.diary'),
      subtitle: diaryCount > 0 ? t('home.feeders.diaryCount', { count: diaryCount }) : t('home.feeders.diaryCta'),
      onPress: () => router.push('/diary'),
    },
  ];

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/more')}
              hitSlop={8}
              style={({ pressed }) => ({
                opacity: pressed ? 0.5 : 1,
                flexDirection: 'row',
                alignItems: 'center',
              })}
            >
              <Text style={[{ color: theme.primary, fontSize: 16, marginRight: 2 }, theme.font.bodySemiBold]}>
                {t('home.moreLink')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.primary} />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          theme.isIOS ? styles.iosContent : styles.androidContent,
          { paddingBottom: 96 + insets.bottom },
        ]}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text style={[styles.greeting, { color: theme.subtle }, theme.font.body]}>
          {t('home.greeting')}
        </Text>

        {paused ? (
          <Card style={styles.pauseBanner}>
            <Text style={[styles.pauseTitle, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('home.paused.title')}
            </Text>
            <Text style={[styles.pauseBody, { color: theme.subtle }, theme.font.body]}>
              {t('home.paused.body')}
            </Text>
            <Pressable
              onPress={onResume}
              style={({ pressed }) => [styles.pauseBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.pauseBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                {t('home.paused.resume')}
              </Text>
            </Pressable>
          </Card>
        ) : null}

        <View style={styles.hero}>
          <BodyMindCard
            eyebrow={hero.eyebrow}
            accent={hero.accent}
            headline={hero.headline}
            basis={hero.basis}
            caption={hero.caption}
            bodyLabel={t('home.bodyMindCol.body')}
            bodyValue={steps != null ? formatSteps(steps) : '—'}
            mindLabel={t('home.bodyMindCol.mind')}
            mindValue={moodValue != null ? `${moodValue}/10` : '—'}
          />
        </View>

        <Card style={styles.moodCard}>
          <View style={styles.moodHead}>
            <Text style={[styles.moodTitle, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('home.moodNow.title')}
            </Text>
            <Text style={[styles.moodHint, { color: theme.subtle }, theme.font.body]}>
              {t('home.moodNow.hint')}
            </Text>
          </View>
          <View style={{ marginTop: 14 }}>
            <MoodScale selected={moodValue} onPick={onPickMood} disabled={db == null} />
          </View>
        </Card>

        <SectionHeader>{t('home.feeders.header')}</SectionHeader>
        <ListGroup rows={feeders} />

        {streakWeeks > 0 ? (
          <Text style={[styles.northStar, { color: theme.accent }, theme.font.bodyMedium]}>
            {t('home.northStar', { weeks: streakWeeks })}
          </Text>
        ) : null}
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('home.gentleNorm')}</Text>
      </ScrollView>

      <View
        style={[
          styles.footer,
          theme.isIOS ? styles.footerIOS : styles.footerAndroid,
          { bottom: (theme.isIOS ? 12 : 16) + insets.bottom },
        ]}
      >
        <FoodBar
          placeholder={t('home.foodBar.placeholder')}
          onPressText={() => router.push('/food/log')}
          onPressMic={() => router.push('/food/log?voice=1')}
        />
      </View>
    </View>
  );
}

/// Picks the plural-correct "N more days" key. i18next here is configured without
/// the plural-suffix plugin, so we branch explicitly (ru: one/few/many, en:
/// one/other) to keep the building copy grammatical.
function buildingKey(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'home.hero.buildingOne';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'home.hero.buildingFew';
  }
  return 'home.hero.buildingMany';
}

/// Thin-space thousands so "6 240" reads like the mockup.
function formatSteps(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  androidContent: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 96 },
  iosContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 96 },
  greeting: { fontSize: 14, lineHeight: 20, marginBottom: 2 },
  hero: { marginTop: 14 },
  moodCard: { marginTop: 14 },
  moodHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  moodTitle: { fontSize: 15 },
  moodHint: { fontSize: 12 },
  northStar: { fontSize: 12, textAlign: 'center', marginTop: 22 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  footer: { position: 'absolute', left: 0, right: 0 },
  footerAndroid: { paddingHorizontal: 18 },
  footerIOS: { paddingHorizontal: 16 },
  pauseBanner: { marginBottom: 4 },
  pauseTitle: { fontSize: 16 },
  pauseBody: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  pauseBtn: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, marginTop: 12 },
  pauseBtnText: { fontSize: 14 },
});
