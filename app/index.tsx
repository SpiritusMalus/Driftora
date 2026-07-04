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
import { selfInitiatedLogDays } from '@/lib/core/db/activity';
import { hasAnyWinOnDay, runAutoWins } from '@/lib/core/db/autoWins';
import { bestBodyMindFromDb } from '@/lib/core/db/bodyMind';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { countDiaryEntries } from '@/lib/core/db/diary';
import { todayMacroTotals } from '@/lib/core/db/food';
import { latestMood, logMood } from '@/lib/core/db/mood';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { syncDaySleep } from '@/lib/core/db/sleep';
import { dayKey, listStepsDays, syncDaySteps } from '@/lib/core/db/steps';
import { weekReview } from '@/lib/core/db/weekReview';
import { latestWeight } from '@/lib/core/db/weight';
import { personalBaseline, type PersonalBaseline } from '@/lib/core/insights/baseline';
import {
  MIN_PAIRED_DAYS,
  type BodyMindSignal,
  type SignalAssociation,
} from '@/lib/core/insights/bodyMind';
import { daySummary, daysSince, type DaySummary } from '@/lib/core/insights/daySummary';
import { sleepBand, sleepHours } from '@/lib/core/insights/sleepInsight';
import { dayOfYear, pickVariant } from '@/lib/core/insights/variant';
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
  // Today's steps vs the user's OWN recent normal (personal baseline). null/
  // 'forming' while we don't have enough days to make an honest high/low claim.
  const [stepsBaselineKind, setStepsBaselineKind] =
    useState<PersonalBaseline['kind'] | null>(null);
  const [sleepMin, setSleepMin] = useState<number | null>(null);
  const [proteinG, setProteinG] = useState(0);
  const [diaryCount, setDiaryCount] = useState(0);
  const [best, setBest] = useState<SignalAssociation | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [moodValue, setMoodValue] = useState<number | null>(null);
  const [streakWeeks, setStreakWeeks] = useState(0);
  const [paused, setPaused] = useState(false);
  const [weightRow, setWeightRow] = useState<{ weightKg: number; date: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const [tot, settings, diaryN, moodRow, review, weightLatest] = await Promise.all([
          todayMacroTotals(db),
          ensureSettings(db),
          countDiaryEntries(db),
          latestMood(db),
          weekReview(db),
          latestWeight(db),
        ]);
        const svc = getHealthService();
        // Sync today's passive signals first so the read reflects today too.
        // `stepCount` is null when there's genuinely no data (no device source
        // wired + nothing entered) — kept distinct from a real 0 so Home shows
        // "no data", not a fabricated count. Goal/celebration math treats null
        // as 0 (no steps → no steps win).
        const stepCount = await syncDaySteps(db, svc);
        const stepsForGoals = stepCount ?? 0;
        // Personal baseline: today vs the median of recent prior days (steps
        // only — ED-safe). Pull a generous window, drop today, feed the totals.
        const todayKey = dayKey();
        const recentSteps = (await listStepsDays(db, 31))
          .filter((r) => r.date !== todayKey)
          .map((r) => Number(r.steps));
        const stepsBaseline =
          stepCount == null ? null : personalBaseline(recentSteps, stepCount);
        const sleepMinutes = await syncDaySleep(db, svc);
        const bestLink = await bestBodyMindFromDb(db);
        // Celebrate the day's earned goals automatically (deduped per day). A
        // quiet background behavior, not a Home card — kept as-is.
        await runAutoWins(
          db,
          {
            steps: stepsForGoals,
            stepsGoal: settings.stepsGoal,
            proteinG: tot.proteinG,
            proteinTargetG: settings.targetProteinG,
            paused: settings.paused,
          },
          {
            // Rotate the celebration copy by day-of-year — varied & specific,
            // never a hollow "Отлично!". Stable per day, matching the
            // once-per-day award dedup so the stored message stays consistent.
            stepsGoal: pickVariant(
              [
                t('wins.auto.stepsGoal', { steps: stepsForGoals }),
                t('wins.auto.stepsGoal2', { steps: stepsForGoals }),
                t('wins.auto.stepsGoal3', { steps: stepsForGoals }),
                t('wins.auto.stepsGoal4', { steps: stepsForGoals }),
              ],
              dayOfYear(),
            ),
            proteinGoal: pickVariant(
              [
                t('wins.auto.proteinGoal', { protein: Math.round(tot.proteinG) }),
                t('wins.auto.proteinGoal2', { protein: Math.round(tot.proteinG) }),
                t('wins.auto.proteinGoal3', { protein: Math.round(tot.proteinG) }),
                t('wins.auto.proteinGoal4', { protein: Math.round(tot.proteinG) }),
              ],
              dayOfYear(),
            ),
          },
        );
        const wonToday = await hasAnyWinOnDay(db);
        // Days since the last self-initiated log (mood/food/diary/win/weight) —
        // drives the forgiving "welcome back" line when today is otherwise empty.
        const logDays = await selfInitiatedLogDays(db);
        let lastActivity: Date | null = null;
        for (const d of logDays) {
          const [y, m, day] = d.split('-').map(Number);
          const dt = new Date(y, m - 1, day);
          if (lastActivity == null || dt > lastActivity) lastActivity = dt;
        }
        const daysGap = daysSince(lastActivity);
        if (!active) return;
        setSteps(stepCount);
        setStepsMeaning(stepCount == null ? null : stepInsight(stepCount, settings.stepsGoal));
        setStepsBaselineKind(stepsBaseline ? stepsBaseline.kind : null);
        setSleepMin(sleepMinutes);
        setProteinG(tot.proteinG);
        setDiaryCount(diaryN);
        setBest(bestLink);
        setMoodValue(moodRow ? moodRow.value : null);
        setStreakWeeks(review.streakWeeks);
        setPaused(settings.paused);
        setWeightRow(weightLatest ? { weightKg: weightLatest.weightKg, date: weightLatest.date } : null);
        setSummary(
          daySummary(
            {
              steps: stepCount,
              mood: moodRow ? moodRow.value : null,
              hasWinToday: wonToday,
              daysSinceLastActivity: daysGap,
            },
            dayOfYear(),
          ),
        );
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

  // The signal the hero speaks about (steps / sleep / protein), and today's
  // value + glyph for its body column. Defaults to steps while still forming.
  const heroSignal: BodyMindSignal = best?.signal ?? 'steps';
  const signalNoun = t(`home.hero.signalNoun.${heroSignal}`);

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
    const result = best?.result;
    if (!result || result.kind === 'insufficient') {
      const remaining = Math.max(1, MIN_PAIRED_DAYS - (result?.pairedDays ?? 0));
      return {
        eyebrow,
        headline: t(buildingKey(remaining), { days: remaining, signal: signalNoun }),
        caption: t('home.hero.buildingCaption'),
      };
    }
    const basis = t('home.bodyMind.basis', { days: result.pairedDays, signal: signalNoun });
    if (result.kind === 'no_link') {
      return {
        eyebrow,
        headline: t(`bodyMind.hero.signalNoLink.${heroSignal}`),
        basis,
        caption: t('home.hero.caption'),
      };
    }
    const dir = result.direction === 'more_better' ? 'better' : 'worse';
    return {
      eyebrow,
      accent: t('bodyMind.hero.accent', { gap: result.moodGap }),
      headline: t(`bodyMind.hero.signal.${heroSignal}.${dir}`, { gap: result.moodGap }),
      basis,
      caption: t('home.hero.caption'),
    };
  })();

  const bodyColValue = ((): string => {
    if (heroSignal === 'sleep') {
      return sleepMin != null ? `${sleepHours(sleepMin)} ${t('units.h')}` : '—';
    }
    if (heroSignal === 'protein') {
      return `${Math.round(proteinG)} ${t('units.g')}`;
    }
    return steps != null ? formatSteps(steps) : '—';
  })();
  const bodyColIcon = SIGNAL_ICON[heroSignal];

  // Personalize the steps line once there's enough history: speak to the user's
  // OWN normal ("above/typical/quieter than usual") instead of the generic
  // evidence line. While still 'forming' (or with no baseline yet) keep the
  // honest generic meaning — never a high/low claim we can't back.
  const stepsMeaningLine =
    stepsBaselineKind != null && stepsBaselineKind !== 'forming'
      ? t(`home.baseline.${stepsBaselineKind}`)
      : stepsMeaning;
  const stepsSubtitle =
    steps == null || stepsMeaningLine == null
      ? t('home.comingSoon')
      : `${formatSteps(steps)} — ${stepsMeaningLine}`;

  const sleepSubtitle =
    sleepMin == null
      ? t('home.comingSoon')
      : `${sleepHours(sleepMin)} ${t('units.h')} — ${t(`home.sleep.meaning.${sleepBand(sleepMin)}`)}`;

  // «92.4 кг — 3 дн. назад» or a gentle weekly-cadence CTA before the first log.
  const weightSubtitle = (() => {
    if (weightRow == null) return t('home.feeders.weightCta');
    const kg = weightRow.weightKg.toFixed(1);
    const days = daysAgo(weightRow.date);
    if (days <= 0) return t('home.feeders.weightToday', { kg });
    if (days === 1) return t('home.feeders.weightYesterday', { kg });
    return t('home.feeders.weightDaysAgo', { kg, days });
  })();

  const feeders: RowSpec[] = [
    {
      key: 'steps',
      icon: 'walk-outline',
      tint: theme.accent,
      iconBg: theme.scheme === 'light' ? '#FBEFD9' : '#33261F',
      title: t('home.feeders.steps'),
      subtitle: stepsSubtitle,
      onPress: () => router.push('/steps'),
    },
    {
      key: 'sleep',
      icon: 'moon-outline',
      tint: theme.primary,
      iconBg: theme.scheme === 'light' ? '#E9E2FA' : '#272138',
      title: t('home.feeders.sleep'),
      subtitle: sleepSubtitle,
    },
    {
      key: 'weight',
      icon: 'scale-outline',
      tint: theme.accent,
      iconBg: theme.scheme === 'light' ? '#EFE6E0' : '#2C2622',
      title: t('home.feeders.weight'),
      subtitle: weightSubtitle,
      onPress: () => router.push('/weight'),
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

  // Rotate the feeder section header across a few warm variants — stable within
  // a day (day-of-year seed), so Home feels alive without changing mid-session.
  const feederHeader = pickVariant(
    [
      t('home.feeders.header'),
      t('home.feeders.header2'),
      t('home.feeders.header3'),
      t('home.feeders.header4'),
    ],
    dayOfYear(),
  );

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

        {summary ? (
          <Text style={[styles.daySummary, { color: theme.text }, theme.font.bodyMedium]}>
            {t(`home.daySummary.${summary.key}`, {
              steps: summary.steps != null ? formatSteps(summary.steps) : '',
              mood: summary.mood ?? '',
            })}
          </Text>
        ) : null}

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
            bodyLabel={t(`home.bodyMindCol.bodySignal.${heroSignal}`)}
            bodyValue={bodyColValue}
            bodyIcon={bodyColIcon}
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

        <SectionHeader>{feederHeader}</SectionHeader>
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

/// Whole local days between a 'YYYY-MM-DD' day key and today (0 = today).
function daysAgo(dayString: string): number {
  const [y, m, d] = dayString.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

/// The body-column glyph for each hero signal.
const SIGNAL_ICON: Record<BodyMindSignal, 'walk-outline' | 'moon-outline' | 'nutrition-outline'> = {
  steps: 'walk-outline',
  sleep: 'moon-outline',
  protein: 'nutrition-outline',
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  androidContent: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 96 },
  iosContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 96 },
  greeting: { fontSize: 14, lineHeight: 20, marginBottom: 2 },
  daySummary: { fontSize: 15, lineHeight: 21, marginTop: 8 },
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
