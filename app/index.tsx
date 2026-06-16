import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { InsightHero } from '@/components/InsightHero';
import { runAutoWins } from '@/lib/core/db/autoWins';
import { bodyMindInsightFromDb } from '@/lib/core/db/bodyMind';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { countDiaryEntries } from '@/lib/core/db/diary';
import { todayMacroTotals } from '@/lib/core/db/food';
import { latestMood } from '@/lib/core/db/mood';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { syncDaySteps } from '@/lib/core/db/steps';
import { weekReview } from '@/lib/core/db/weekReview';
import { MIN_PAIRED_DAYS, type BodyMindResult } from '@/lib/core/insights/bodyMind';
import { stepInsight } from '@/lib/core/insights/stepInsight';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { colors, type ThemeColors } from '@/lib/theme/colors';

/// Home is a single-insight surface, not a dashboard. The Body↔Mind read
/// (movement ↔ mood) is the editorial hero at the top; beneath it sit only the
/// small inputs that *feed* that insight (a one-tap mood, today's steps, the
/// diary). Everything else — food, weight, wins, weekly review, settings — lives
/// behind the "More" link. The hero's honesty states are preserved exactly: it
/// stays a building-up placeholder below the paired-days gate, shows an honest
/// "no clear link yet", and always frames the finding as association, not cause.
export default function HomeScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const router = useRouter();
  const db = useDatabase();

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
        // Celebrate the day's earned goals automatically (deduped per day). This
        // is a quiet background behavior, not a Home card — kept as-is.
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
      : `${steps} ${t('home.steps.unit')}\n${stepsMeaning}`;

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/more')}
              hitSlop={8}
              style={({ pressed }) => ({
                opacity: pressed ? 0.5 : 1,
                paddingHorizontal: 4,
                flexDirection: 'row',
                alignItems: 'center',
              })}
            >
              <Text style={{ color: theme.text, fontSize: 16, marginRight: 2 }}>
                {t('home.moreLink')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.text} />
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

        <InsightHero
          eyebrow={hero.eyebrow}
          accent={hero.accent}
          headline={hero.headline}
          basis={hero.basis}
          caption={hero.caption}
          theme={theme}
        />

        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <Text style={[styles.feedersHeader, { color: theme.subtle }]}>
          {t('home.feeders.header').toUpperCase()}
        </Text>

        <FeederRow
          icon="happy-outline"
          title={t('home.feeders.mood')}
          subtitle={moodValue != null ? t('home.feeders.moodValue', { value: moodValue }) : t('home.feeders.moodCta')}
          theme={theme}
          onPress={() => router.push('/mood')}
        />
        <FeederRow
          icon="walk-outline"
          title={t('home.feeders.steps')}
          subtitle={stepsSubtitle}
          theme={theme}
        />
        <FeederRow
          icon="sparkles-outline"
          title={t('home.feeders.diary')}
          subtitle={diaryCount > 0 ? t('home.feeders.diaryCount', { count: diaryCount }) : t('home.feeders.diaryCta')}
          theme={theme}
          onPress={() => router.push('/diary')}
        />

        {streakWeeks > 0 ? (
          <Text style={[styles.northStar, { color: theme.subtle }]}>
            {t('home.northStar', { weeks: streakWeeks })}
          </Text>
        ) : null}
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('home.gentleNorm')}</Text>
      </ScrollView>
    </>
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
    // 'few' in ru; en lacks this bucket and falls back to its 'other' string.
    return 'home.hero.buildingFew';
  }
  return 'home.hero.buildingMany';
}

/// A compact feeder line: an input that builds the hero, deliberately lighter
/// than the old dashboard cards (no surrounding card, thin rule between).
function FeederRow({
  icon,
  title,
  subtitle,
  theme,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  theme: ThemeColors;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Ionicons name={icon} size={20} color={theme.icon} style={{ marginRight: 14, marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.feederTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.feederSubtitle, { color: theme.subtle }]}>{subtitle}</Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={theme.subtle} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.feederRow, { opacity: pressed ? 0.6 : 1 }]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={styles.feederRow}>{body}</View>;
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  greeting: { fontSize: 15, lineHeight: 21, marginBottom: 8 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 16 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 8, marginBottom: 16 },
  feedersHeader: { fontSize: 12, letterSpacing: 1.2, fontWeight: '600', marginBottom: 8 },
  feederRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 12 },
  feederTitle: { fontSize: 15, fontWeight: '600' },
  feederSubtitle: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  northStar: { fontSize: 12, textAlign: 'center', marginTop: 20 },
  pauseBanner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
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
