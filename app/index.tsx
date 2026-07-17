import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FoodTodayWidget } from '@/components/home/FoodTodayWidget';
import { StepsWidget } from '@/components/home/StepsWidget';
import { WorkoutWidget } from '@/components/home/WorkoutWidget';
import { SwipeCoach } from '@/components/home/SwipeCoach';
import { WeightWidget } from '@/components/home/WeightWidget';
import { Card } from '@/components/ui/Card';
import { DayTitleLink } from '@/components/ui/DayTitleLink';
import { FoodBar } from '@/components/ui/FoodBar';
import { HeaderSectionsLink } from '@/components/ui/HeaderSectionsLink';
import { selfInitiatedLogDays } from '@/lib/core/db/activity';
import { hasAnyWinOnDay, runAutoWins } from '@/lib/core/db/autoWins';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { todayMacroTotals } from '@/lib/core/db/food';
import type { AppSettings } from '@/lib/core/db/schema';
import { latestMood } from '@/lib/core/db/mood';
import { syncDayHealth } from '@/lib/core/db/healthSync';
import { ensureSettings, parseReminderTimes, updateSettings } from '@/lib/core/db/settings';
import { dayKey, listStepsDays, typicalSteps } from '@/lib/core/db/steps';
import { weekReview } from '@/lib/core/db/weekReview';
import { latestWeight } from '@/lib/core/db/weight';
import { todayWorkoutKcal } from '@/lib/core/db/workouts';
import {
  dayBudgetKcal,
  EATBACK_FRACTION,
  restingPlan,
  stepsEarnedKcal,
  stepsOutsideWorkouts,
} from '@/lib/core/insights/bodyMetrics';
import { personalBaseline, type PersonalBaseline } from '@/lib/core/insights/baseline';
import { daySummary, daysSince, type DaySummary } from '@/lib/core/insights/daySummary';
import { dayOfYear, pickVariant } from '@/lib/core/insights/variant';
import { stepInsight } from '@/lib/core/insights/stepInsight';
import { useAppActiveEffect } from '@/lib/core/services/appActive';
import { pluralKey } from '@/lib/i18n/plural';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { getNotificationService } from '@/lib/core/services/notificationProvider';
import { buildDailyReminders, rescheduleReminders } from '@/lib/core/services/reminders';
import { useTheme } from '@/lib/theme/theme';

/// Home is the BODY-tracking surface (device feedback 2026-07-10: «разделить
/// тренировки и психику»): food, weight, activity — the things fed daily. The
/// whole mind side (mood scale, the Body↔Mind insight, the thought diary, the
/// sleep signal) lives on the mood screen, opened by a LEFT SWIPE anywhere on
/// Home (device feedback 2026-07-12: the mood row was the last non-body card
/// here). A one-time interactive coach teaches the gesture, a subtle caption
/// keeps reminding until it sticks (3 swipe-opens), and «Разделы» keeps a
/// plain tappable path. Home still runs the passive steps/sleep sync so those
/// signals keep flowing into the insight regardless of which screen shows them.
export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const insets = useSafeAreaInsets();

  const [steps, setSteps] = useState<number | null>(null);
  // Median of recent recorded days — the food budget's morning stand-in until
  // today's steps exist («как обычно у вас»). Never shown in the steps widget
  // itself: that one is the FACT/input, the forecast only feeds the budget.
  const [usualSteps, setUsualSteps] = useState<number | null>(null);
  const [stepsMeaning, setStepsMeaning] = useState<string | null>(null);
  // Today's steps vs the user's OWN recent normal (personal baseline). null/
  // 'forming' while we don't have enough days to make an honest high/low claim.
  const [stepsBaselineKind, setStepsBaselineKind] =
    useState<PersonalBaseline['kind'] | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [streakWeeks, setStreakWeeks] = useState(0);
  const [paused, setPaused] = useState(false);
  const [weightRow, setWeightRow] = useState<{ weightKg: number; date: string } | null>(null);
  // Today's food totals + the settings row — fed to the Home input widgets
  // (food summary, weight plan preview). Kept alongside the insight state above.
  const [totals, setTotals] = useState({ kcal: 0, proteinG: 0, fatG: 0, carbG: 0 });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // Raw workout burn today — for the food widget's movement-adjusted target
  // (steps are already loaded above; both feed the same eat-back layer).
  const [workoutRawKcal, setWorkoutRawKcal] = useState(0);
  // Steps inside today's device-imported workout windows (merged union) — the
  // eating budget prices steps MINUS these; display/goals keep the raw count.
  const [workoutSteps, setWorkoutSteps] = useState(0);
  // One /mood push per left-swipe gesture — releases when Home regains focus.
  const swipeNavLock = useRef(false);

  const reload = useCallback(async () => {
        if (!db) return;
        // Settings FIRST (the extended-import flag), then the passive sync, and
        // only THEN the workout-kcal read: after watch imports landed, reading
        // todayWorkoutKcal in parallel with the sync raced against the very
        // sessions it's about to show.
        const settingsRow = await ensureSettings(db);
        const svc = getHealthService();
        // Sync today's passive signals first so the read reflects today too.
        // `stepCount` is null when there's genuinely no data (no device source
        // wired + nothing entered) — kept distinct from a real 0 so Home shows
        // "no data", not a fabricated count. Goal/celebration math treats null
        // as 0 (no steps → no steps win). Sleep is synced inside too: it stays
        // on Home (the app's entry) so the sleep↔mood insight keeps its data
        // even though sleep is DISPLAYED on the mood screen only.
        const health = await syncDayHealth(db, svc, new Date(), settingsRow.healthImportExtended);
        const stepCount = health.steps;
        const [tot, moodRow, review, weightLatest, workoutKcal] = await Promise.all([
          todayMacroTotals(db),
          latestMood(db),
          weekReview(db),
          latestWeight(db),
          todayWorkoutKcal(db),
        ]);
        const stepsForGoals = stepCount ?? 0;
        // Personal baseline: today vs the median of recent prior days (steps
        // only — ED-safe). Pull a generous window, drop today, feed the totals.
        // RAW steps on purpose — only the eating budget subtracts the workout
        // windows; goals/wins/insights keep the real movement.
        const todayKey = dayKey();
        const recentSteps = (await listStepsDays(db, 31))
          .filter((r) => r.date !== todayKey)
          .map((r) => Number(r.steps));
        const stepsBaseline =
          stepCount == null ? null : personalBaseline(recentSteps, stepCount);
        // Celebrate the day's earned goals automatically (deduped per day). A
        // quiet background behavior, not a Home card — kept as-is.
        await runAutoWins(
          db,
          {
            steps: stepsForGoals,
            stepsGoal: settingsRow.stepsGoal,
            proteinG: tot.proteinG,
            proteinTargetG: settingsRow.targetProteinG,
            paused: settingsRow.paused,
          },
          {
            // Rotate the celebration copy by day-of-year — varied & specific,
            // never a hollow "Отлично!". Stable per day, matching the
            // once-per-day award dedup so the stored message stays consistent.
            stepsGoal: pickVariant(
              [
                t('wins.auto.stepsGoal', { steps: stepsForGoals, stepsWord: t(pluralKey('steps.unit', stepsForGoals)) }),
                t('wins.auto.stepsGoal2', { steps: stepsForGoals, stepsWord: t(pluralKey('steps.unit', stepsForGoals)) }),
                t('wins.auto.stepsGoal3', { steps: stepsForGoals, stepsWord: t(pluralKey('steps.unit', stepsForGoals)) }),
                t('wins.auto.stepsGoal4', { steps: stepsForGoals, stepsWord: t(pluralKey('steps.unit', stepsForGoals)) }),
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
        setSteps(stepCount);
        setWorkoutSteps(health.workoutSteps);
        setUsualSteps(await typicalSteps(db));
        // A break promises «цели выключены» — feed an unreachable goal so the
        // insight can never say «личная цель достигнута» under the pause banner.
        setStepsMeaning(
          stepCount == null
            ? null
            : stepInsight(stepCount, settingsRow.paused ? Number.MAX_SAFE_INTEGER : settingsRow.stepsGoal),
        );
        setStepsBaselineKind(stepsBaseline ? stepsBaseline.kind : null);
        setTotals({ kcal: tot.kcal, proteinG: tot.proteinG, fatG: tot.fatG, carbG: tot.carbG });
        setSettings(settingsRow);
        setWorkoutRawKcal(workoutKcal);
        setStreakWeeks(review.streakWeeks);
        setPaused(settingsRow.paused);
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
  }, [db, t]);

  useFocusEffect(
    useCallback(() => {
      swipeNavLock.current = false;
      void reload();
    }, [reload]),
  );

  // Unlocking the phone hours later must re-read the device steps: the budget
  // and the steps row otherwise stay at the morning count until some in-app
  // navigation happens to re-focus this screen.
  useAppActiveEffect(() => void reload());

  async function onResume() {
    if (!db) return;
    const s = await updateSettings(db, { paused: false });
    setPaused(false);
    // Refresh the full row too — hasGoal and the coach read settings.paused,
    // and the stale object kept the food target hidden until the next focus.
    setSettings(s);
    // The break also cancelled the OS reminders (the settings screen clears
    // them on save while paused). «Вернуться к целям» must bring them back —
    // otherwise they stay dead until a random settings re-save. Contextual
    // nudges are deliberately not planned here: they are recomputed from the
    // moment's context on each settings save. Best-effort, like that screen.
    try {
      const service = getNotificationService();
      await service.initialize();
      const specs = buildDailyReminders(
        parseReminderTimes(s.reminderTimes),
        { title: t('notifications.reminderTitle'), body: t('notifications.reminderBody') },
        false,
      );
      if (specs.length > 0) await service.requestPermissions();
      await rescheduleReminders(service, specs);
    } catch (e) {
      console.warn('reminder rescheduling on resume failed', e);
    }
  }

  // Personalize the steps line once there's enough history: speak to the user's
  // OWN normal ("above/typical/quieter than usual") instead of the generic
  // evidence line. While still 'forming' (or with no baseline yet) keep the
  // honest generic meaning — never a high/low claim we can't back.
  const stepsMeaningLine =
    stepsBaselineKind != null && stepsBaselineKind !== 'forming'
      ? t(`home.baseline.${stepsBaselineKind}`)
      : stepsMeaning;
  // No steps yet is an INVITATION, not a locked feature — the input unfolds via
  // [+], so the old «Скоро» placeholder read as "doesn't work" (device
  // feedback 2026-07-10).
  const stepsSubtitle =
    steps == null || stepsMeaningLine == null
      ? t('home.steps.noneYet')
      : `${formatSteps(steps)} — ${stepsMeaningLine}`;

  // «92.4 кг — 3 дн. назад» or a gentle weekly-cadence CTA before the first log.
  const weightSubtitle = (() => {
    if (weightRow == null) return t('home.feeders.weightCta');
    const kg = weightRow.weightKg.toFixed(1);
    const days = daysAgo(weightRow.date);
    if (days <= 0) return t('home.feeders.weightToday', { kg });
    if (days === 1) return t('home.feeders.weightYesterday', { kg });
    return t('home.feeders.weightDaysAgo', { kg, days });
  })();

  // The whole MIND side behind a LEFT SWIPE: mood scale, the Body↔Mind insight,
  // the thought diary and the sleep signal live on the mood screen («разделить
  // тренировки и психику», 2026-07-10; the row itself retired 2026-07-12 —
  // «убрать настроение с главной, открывать свайпом»). One push per gesture:
  // the lock releases when Home regains focus (see useFocusEffect above).
  const openMoodBySwipe = useCallback(() => {
    if (swipeNavLock.current) return;
    swipeNavLock.current = true;
    router.push('/mood');
    // Count successful swipe-opens while the caption hint still teaches; after
    // three the hint retires for good, so no further writes are needed.
    if (db != null && settings != null && settings.moodSwipeOpens < 3) {
      void updateSettings(db, { moodSwipeOpens: settings.moodSwipeOpens + 1 }).then(setSettings);
    }
  }, [db, settings, router]);
  // One-time interactive coach (existing installs see it on the first open
  // after the update; fresh installs right after onboarding). The caption hint
  // below the cards keeps whispering the gesture until it stuck — three real
  // swipe-opens — then Home goes quiet; «Разделы» keeps the tappable path.
  const coachVisible = db != null && settings != null && !settings.moodSwipeCoachSeen;
  const swipeHintVisible = !coachVisible && settings != null && settings.moodSwipeOpens < 3;
  // The PanResponder is created once; route the trigger and the coach state
  // through refs so the predicates never go stale. Claim only decisively
  // horizontal-left drags (capture phase, before the vertical ScrollView takes
  // over): ≥28 px left AND clearly flatter than vertical — diagonal scrolls
  // stay scrolls. While the coach overlay is up, the ROOT must not claim —
  // capture runs parent-first, and stealing the swipe here would open /mood
  // without ever marking the coach as passed.
  const swipeRef = useRef(openMoodBySwipe);
  swipeRef.current = openMoodBySwipe;
  const coachActiveRef = useRef(false);
  coachActiveRef.current = coachVisible;
  const homePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => swipeLeft(g.dx, g.dy) && !coachActiveRef.current,
      onMoveShouldSetPanResponderCapture: (_, g) => swipeLeft(g.dx, g.dy) && !coachActiveRef.current,
      onPanResponderGrant: () => swipeRef.current(),
    }),
  ).current;

  // A target/КБЖУ is shown only when it was DELIBERATELY set — the untouched
  // 2000/120/70/200 defaults are not a goal (mirrors the food-day card, which
  // hides the goal otherwise). Without one, the widget shows just what was eaten.
  const hasGoal = settings != null && settings.targetsSetAt != null && !settings.paused && settings.targetKcal > 0;
  // «Base + earned» — the SAME budget the food day shows: the tempo's deficit
  // base plus the eat-back share of today's earned activity, never below the
  // healthy day-minimum ([dayBudgetKcal]). Until today's steps are entered the
  // earned part stands on the median of recent days («как обычно») and the
  // number reads as ≈. Falls back to the frozen target when the profile can't
  // compute a plan.
  const dayBase =
    settings != null
      ? restingPlan(
          {
            sex: settings.sex,
            birthYear: settings.birthYear,
            heightCm: settings.heightCm,
            activityLevel: settings.activityLevel,
            bodyFatPct: settings.bodyFatPct,
          },
          weightRow?.weightKg ?? 0,
          settings.goalMode,
          new Date(),
          settings.goalWeightKg,
          settings.deficitTempo,
        )
      : null;
  // Priced steps: today's real count minus the workout-window union (a watch-
  // imported run already earns through workoutRawKcal — pricing its steps too
  // would double-count). A forecast day has no windows to subtract.
  const budgetSteps =
    steps != null ? stepsOutsideWorkouts(steps, workoutSteps) : (usualSteps ?? 0);
  const stepsEarnedAdd = stepsEarnedKcal(budgetSteps, weightRow?.weightKg ?? 0);
  const earnedAdd = stepsEarnedAdd + Math.round(Math.max(0, workoutRawKcal) * EATBACK_FRACTION);
  const foodTargetKcal = hasGoal
    ? dayBase != null
      ? dayBudgetKcal(dayBase.baseKcal, dayBase.minDayKcal, earnedAdd)
      : (settings?.targetKcal ?? 0) + earnedAdd
    : 0;
  // Forecast only makes the target «≈» when it actually moves the number.
  const foodTargetApprox = steps == null && usualSteps != null && stepsEarnedAdd > 0;

  // The «а что дальше?» card: while the day budget can't be computed (body
  // profile incomplete or no weigh-in yet) Home points at the body-setup
  // wizard. Disappears for good once the profile + weight exist.
  const setupNeeded = db != null && settings != null && dayBase == null;

  // While no movement is logged, the food widget's target is the RESTING budget
  // — say so explicitly, or the low number reads as the day's ceiling (device
  // feedback: «не понял, что тренировки забустят»).
  const movementHint =
    hasGoal && dayBase != null && earnedAdd === 0 ? t('home.food.movementHint') : null;
  // Value ladder for the no-goal user: once a WEIGHT is logged, today's steps get
  // an honest «≈ N ккал» estimate — walking becomes a real number without needing
  // the full profile/goal. Suppressed once a goal is active (the food budget's
  // «шаги +N» already shows it there, so this would just duplicate it). Needs
  // steps above the resting baseline, so [stepsEarnedKcal] > 0 gates it.
  const stepsEstimateKcal =
    !hasGoal && weightRow != null
      ? stepsEarnedKcal(stepsOutsideWorkouts(steps ?? 0, workoutSteps), weightRow.weightKg)
      : 0;
  const stepsEstimateLine =
    stepsEstimateKcal > 0
      ? t('home.steps.earnedEstimate', { kcal: stepsEstimateKcal })
      : null;

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]} {...homePan.panHandlers}>
      <Stack.Screen
        options={{
          // The title IS the day switcher: «Сегодня ⌄» opens the day history
          // («выбрать прошлый день и посмотреть логи еды и настроения»).
          headerTitle: () => <DayTitleLink label={t('home.title')} />,
          headerRight: () => <HeaderSectionsLink />,
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
        {/* Noise cleanup 2026-07-10 («много шума, непонятно куда жмать»): the
            greeting tagline and the empty-day summary are gone — a fresh day
            opens straight on the food card. The summary line returns only once
            it has something REAL to say (steps/mood/win/welcome-back). */}
        {summary && summary.key !== 'empty' ? (
          <Text style={[styles.daySummary, { color: theme.text }, theme.font.bodyMedium]}>
            {t(`home.daySummary.${summary.key}`, {
              steps: summary.steps != null ? formatSteps(summary.steps) : '',
              stepsWord: summary.steps != null ? t(pluralKey('steps.unit', summary.steps)) : '',
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

        {setupNeeded ? (
          <Card style={styles.setupCard}>
            <Text style={[styles.pauseTitle, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('home.setup.title')}
            </Text>
            <Text style={[styles.pauseBody, { color: theme.subtle }, theme.font.body]}>
              {t('home.setup.body')}
            </Text>
            <Pressable
              onPress={() => router.push('/body-setup')}
              style={({ pressed }) => [styles.pauseBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.pauseBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                {t('home.setup.cta')}
              </Text>
            </Pressable>
          </Card>
        ) : null}

        {/* FOOD FIRST (device feedback 2026-07-10: «почему еда третьей строчкой»)
            — Home is the body-tracking surface; the mind side sits behind one
            row below. */}
        <FoodTodayWidget
          kcal={totals.kcal}
          targetKcal={foodTargetKcal}
          targetApprox={foodTargetApprox}
          movementHint={movementHint}
          prot={totals.proteinG}
          targetProt={hasGoal ? (dayBase?.prot ?? settings!.targetProteinG) : 0}
          fat={totals.fatG}
          targetFat={hasGoal ? (dayBase?.fat ?? settings!.targetFatG) : 0}
          carb={totals.carbG}
          targetCarb={hasGoal ? (dayBase?.carb ?? settings!.targetCarbG) : 0}
          onPress={() => router.push('/food')}
        />
        <WeightWidget db={db} subtitle={weightSubtitle} onSaved={reload} />
        <StepsWidget
          db={db}
          subtitle={stepsSubtitle}
          estimateLine={stepsEstimateLine}
          onSaved={reload}
        />
        <WorkoutWidget countedKcal={Math.round(Math.max(0, workoutRawKcal) * EATBACK_FRACTION)} />
        {/* Whispered affordance for the left swipe — tappable too (some will
            tap the words; screen readers get a plain button). Retires after
            the gesture stuck: three real swipe-opens. */}
        {swipeHintVisible ? (
          <Pressable
            onPress={() => router.push('/mood')}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('home.swipeHint')}
            style={({ pressed }) => [styles.swipeHintWrap, { opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="chevron-back" size={13} color={theme.subtle} />
            <Text style={[styles.swipeHint, { color: theme.subtle }, theme.font.body]}>
              {t('home.swipeHint')}
            </Text>
          </Pressable>
        ) : null}

        {streakWeeks > 0 ? (
          <Text style={[styles.northStar, { color: theme.accent }, theme.font.bodyMedium]}>
            {t('home.northStar', { weeks: streakWeeks })}
          </Text>
        ) : null}
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
          // Unique token per tap so every mic press re-triggers voice on the log
          // screen — a constant `?voice=1` can't re-fire if the screen is reused or
          // the same route is re-navigated, which read as "mic does nothing".
          onPressMic={() => router.push(`/food/log?voice=${Date.now()}`)}
        />
      </View>

      {coachVisible ? (
        <SwipeCoach
          onSwiped={() => {
            // Push first (the payoff of the gesture), persist behind it. The
            // coach swipe is swipe-open №1, so the caption hint needs two more.
            router.push('/mood');
            void updateSettings(db, {
              moodSwipeCoachSeen: true,
              moodSwipeOpens: settings.moodSwipeOpens + 1,
            }).then(setSettings);
          }}
          onLater={() => {
            void updateSettings(db, { moodSwipeCoachSeen: true }).then(setSettings);
          }}
        />
      ) : null}
    </View>
  );
}


/// Decisively horizontal-left drag: ≥28 px leftward and clearly flatter than
/// vertical, so diagonal scroll attempts stay with the ScrollView.
function swipeLeft(dx: number, dy: number): boolean {
  return dx < -28 && Math.abs(dx) > Math.abs(dy) * 1.75;
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  androidContent: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 96 },
  iosContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 96 },
  daySummary: { fontSize: 15, lineHeight: 21, marginTop: 8, marginBottom: 10 },
  swipeHintWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingVertical: 6,
  },
  swipeHint: { fontSize: 13 },
  northStar: { fontSize: 12, textAlign: 'center', marginTop: 22 },
  footer: { position: 'absolute', left: 0, right: 0 },
  footerAndroid: { paddingHorizontal: 18 },
  footerIOS: { paddingHorizontal: 16 },
  pauseBanner: { marginBottom: 4 },
  setupCard: { marginTop: 12 },
  pauseTitle: { fontSize: 16 },
  pauseBody: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  pauseBtn: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, marginTop: 12 },
  pauseBtnText: { fontSize: 14 },
});
