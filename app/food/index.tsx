import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { FillBar } from '@/components/ui/FillBar';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { dayBudgetKcal, EATBACK_FRACTION, restingPlan, stepsEarnedKcal } from '@/lib/core/insights/bodyMetrics';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listEntriesForDay, repeatFoodEntry, todayMacroTotals, todayMicroTotals, type MicroTotals } from '@/lib/core/db/food';
import { ensureSettings } from '@/lib/core/db/settings';
import { getStepsRow, typicalSteps } from '@/lib/core/db/steps';
import { latestWeight } from '@/lib/core/db/weight';
import { todayWorkoutKcal } from '@/lib/core/db/workouts';
import { dailyMicroNorms, type MicroRow } from '@/lib/core/insights/microNutrients';
import { groupEntriesByMeal } from '@/lib/core/insights/mealType';
import type { FoodEntry } from '@/lib/core/db/schema';
import type { Sex } from '@/lib/core/insights/bodyMetrics';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The user's daily КБЖУ goal, shown only when it was DELIBERATELY set (the
/// untouched 2000/120/70/200 defaults are not a goal) and the app isn't paused.
interface DayGoal {
  kcal: number;
  /// «База + заработал»: the tempo's deficit base (may sit below the healthy
  /// day-minimum) and that minimum — the day target is assembled with
  /// [dayBudgetKcal], so earned movement re-opens the chosen deficit. The
  /// frozen manual-targets fallback uses kcal as the base with no minimum.
  baseKcal: number;
  minDayKcal: number;
  prot: number;
  fat: number;
  carb: number;
  hideCalories: boolean;
}

/// Today's logged food, newest first. Lands here after a save (so the entry is
/// visibly there, not lost to a back-to-Home), and each row opens the
/// view/edit/delete detail. The button adds a new entry via the log screen;
/// the ↻ on a row re-logs that meal right now (numbers were confirmed once).
export default function FoodDayScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const [entries, setEntries] = useState<FoodEntry[] | null>(null);
  const [totals, setTotals] = useState<{ kcal: number; proteinG: number; fatG: number; carbG: number } | null>(null);
  const [goal, setGoal] = useState<DayGoal | null>(null);
  const [micros, setMicros] = useState<MicroTotals | null>(null);
  const [sex, setSex] = useState<'' | Sex>('');
  const [openMicros, setOpenMicros] = useState(false);
  // RAW calories burned in today's logged workouts (before the eat-back share) —
  // read straight from the DB; the workout log itself lives on «Активность» now.
  const [workoutRawKcal, setWorkoutRawKcal] = useState(0);
  // «Base + earned»: today's step count and the kcal it EARNED (added on top of
  // the deficit base). Shown as a transparent «база + шаги + тренировки» sum.
  // Until today's steps are entered, the count is a FORECAST from the median of
  // recent days («как обычно») — flagged so the target reads as ≈.
  const [stepsToday, setStepsToday] = useState(0);
  const [stepsEarned, setStepsEarned] = useState(0);
  const [stepsForecast, setStepsForecast] = useState(false);
  // «Добавлено ещё раз ✓» after a one-tap repeat; cleared after a moment.
  const [repeatAck, setRepeatAck] = useState<string | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (ackTimer.current) clearTimeout(ackTimer.current);
    },
    [],
  );

  const reload = useCallback(async () => {
    if (!db) return;
    const [list, tot, mic, settings, stepsRow, usualSteps, weightRow, workoutKcal] = await Promise.all([
      listEntriesForDay(db),
      todayMacroTotals(db),
      todayMicroTotals(db),
      ensureSettings(db),
      getStepsRow(db),
      typicalSteps(db),
      latestWeight(db),
      todayWorkoutKcal(db),
    ]);
    setEntries(list);
    setTotals(tot);
    setMicros(mic);
    setSex(settings.sex);
    setWorkoutRawKcal(workoutKcal);
    // «Base + earned» budget: the goal card shows a RESTING base (maintenance at
    // the sedentary factor, goal-adjusted) and adds today's earned activity — steps
    // and workouts — ON TOP, transparently. So more movement always raises the day,
    // never lowers it, and activity is never double-counted. Falls back to the
    // frozen applied target when the profile can't compute a plan (manual КБЖУ).
    const base = restingPlan(
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
    );
    const goalActive = settings.targetsSetAt != null && !settings.paused;
    // Morning-planning honesty: before today's steps are entered the budget
    // stands on the median of your recent recorded days («как обычно»), marked
    // as a forecast — the entered fact replaces it the moment it exists.
    const todaySteps = stepsRow != null ? Number(stepsRow.steps) : null;
    const effectiveSteps = todaySteps ?? usualSteps ?? 0;
    setStepsToday(effectiveSteps);
    setStepsForecast(todaySteps == null && usualSteps != null);
    setStepsEarned(stepsEarnedKcal(effectiveSteps, weightRow?.weightKg ?? 0));
    // The progress card needs a deliberate goal AND an unpaused app — otherwise
    // it would pressure with an arbitrary default, which this app never does.
    setGoal(
      goalActive && base != null
        ? {
            kcal: base.kcal,
            baseKcal: base.baseKcal,
            minDayKcal: base.minDayKcal,
            prot: base.prot,
            fat: base.fat,
            carb: base.carb,
            hideCalories: settings.hideCalories,
          }
        : goalActive && settings.targetKcal > 0
          ? {
              kcal: settings.targetKcal,
              baseKcal: settings.targetKcal,
              minDayKcal: 0,
              prot: settings.targetProteinG,
              fat: settings.targetFatG,
              carb: settings.targetCarbG,
              hideCalories: settings.hideCalories,
            }
          : null,
    );
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!active) return;
        await reload();
      })();
      return () => {
        active = false;
      };
    }, [reload]),
  );

  async function onRepeat(id: number) {
    if (!db) return;
    const newId = await repeatFoodEntry(db, id);
    if (newId == null) return;
    await reload();
    setRepeatAck(t('food.repeated'));
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => setRepeatAck(null), 2500);
  }

  return (
    <Screen>
      <PrimaryButton label={t('food.add')} onPress={() => router.push('/food/log')} style={styles.add} />
      {repeatAck ? (
        <Text style={[styles.repeatAck, { color: theme.accent }, theme.font.bodyMedium]}>{repeatAck}</Text>
      ) : null}

      {goal != null && totals != null ? (
        <DayProgress
          goal={goal}
          totals={totals}
          workoutKcalRaw={workoutRawKcal}
          steps={stepsToday}
          stepsEarned={stepsEarned}
          stepsForecast={stepsForecast}
          theme={theme}
        />
      ) : null}

      {db != null && entries != null && entries.length > 0 && micros != null ? (
        <MicroDay
          micros={micros}
          sex={sex}
          open={openMicros}
          onToggle={() => setOpenMicros((v) => !v)}
          theme={theme}
        />
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.dbUnavailable')}</Text>
      ) : entries == null ? null : entries.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.emptyDay')}</Text>
      ) : (
        <View style={styles.list}>
          {groupEntriesByMeal(entries).map((group) => (
            <View key={group.type} style={styles.group}>
              {/* A real section header — meal name + the meal's kcal sum — so the
                  day visibly splits into завтрак/обед/ужин (device feedback). */}
              <View style={[styles.mealHeadRow, { borderBottomColor: theme.separator }]}>
                <Text style={[styles.mealHead, { color: theme.text }, theme.font.bodySemiBold]}>
                  {t(`food.meal.${group.type}`)}
                </Text>
                <Text style={[styles.mealSum, { color: theme.subtle }, theme.font.body]}>
                  {Math.round(group.entries.reduce((sum, e) => sum + e.kcal, 0))} {t('units.kcal')}
                </Text>
              </View>
              {group.entries.map((e) => (
                <Card key={e.id} style={styles.row} onPress={() => router.push(`/food/${e.id}`)}>
                  <View style={styles.rowHead}>
                    <Text style={[styles.rowText, { color: theme.text }, theme.font.bodySemiBold]} numberOfLines={1}>
                      {e.rawText || t('food.untitled')}
                    </Text>
                    <Text style={[styles.rowTime, { color: theme.subtle }, theme.font.body]}>{formatTime(e.ts)}</Text>
                    <Pressable
                      onPress={() => void onRepeat(e.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t('food.repeat')}
                      style={({ pressed }) => [styles.repeatBtn, { opacity: pressed ? 0.5 : 1 }]}
                    >
                      <Ionicons name="repeat-outline" size={18} color={theme.primary} />
                    </Pressable>
                  </View>
                  <Text style={[styles.rowMacros, { color: theme.subtle }, theme.font.body]}>
                    {Math.round(e.kcal)} {t('units.kcal')} · {t('macros.protein')} {Math.round(e.proteinG)}{' '}
                    {t('units.g')} · {t('macros.fat')} {Math.round(e.fatG)} {t('units.g')} · {t('macros.carbs')}{' '}
                    {Math.round(e.carbG)} {t('units.g')}
                  </Text>
                </Card>
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

/// The day against the deliberately-set goal. Calm by design: an amber
/// «в плане ✓» when under, a neutral sentence when over — never red, and no
/// kcal row at all under «спрятать калории».
function DayProgress({
  goal,
  totals,
  workoutKcalRaw,
  steps,
  stepsEarned,
  stepsForecast,
  theme,
}: {
  goal: DayGoal;
  totals: { kcal: number; proteinG: number; fatG: number; carbG: number };
  workoutKcalRaw: number;
  steps: number;
  stepsEarned: number;
  stepsForecast: boolean;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const kcalEaten = Math.round(totals.kcal);
  // «Base + earned» budget, shown as a transparent sum: the deficit base (what
  // the chosen tempo asks for) plus today's steps and workouts ON TOP — never
  // below the healthy day-minimum. Movement always raises the day and re-opens
  // the chosen deficit; only a zero-movement day rests at the minimum.
  const stepsAdd = Math.max(0, stepsEarned);
  const workoutAdd = Math.round(Math.max(0, workoutKcalRaw) * EATBACK_FRACTION);
  const target = dayBudgetKcal(goal.baseKcal, goal.minDayKcal, stepsAdd + workoutAdd);
  const minBinds = goal.baseKcal + stepsAdd + workoutAdd < goal.minDayKcal;
  // A forecast only makes the target «≈» when it actually moves the number.
  const approx = stepsForecast && stepsAdd > 0;
  const onPlan = kcalEaten <= target;
  // The visible breakdown: «покой N · шаги +N · тренировки +N [· не ниже N]».
  const parts = [t('food.day.restBase', { kcal: goal.baseKcal })];
  if (stepsAdd > 0)
    parts.push(t(stepsForecast ? 'food.day.stepsForecastPart' : 'food.day.stepsPart', { kcal: stepsAdd, steps }));
  if (workoutAdd > 0) parts.push(t('food.day.workoutsPart', { kcal: workoutAdd }));
  if (minBinds) parts.push(t('food.day.minPart', { kcal: goal.minDayKcal }));
  // Device feedback 2026-07-10: «не понял, почему цифра такая низкая». With no
  // movement logged yet the breakdown used to hide — exactly when the "steps
  // and workouts raise this number" explanation is needed most. Now the sum is
  // always visible and a zero-movement day gets the explicit line (tappable —
  // it leads to «Активность», where both feeders live).
  const noMovementYet = stepsAdd === 0 && workoutAdd === 0;
  const macros = [
    { label: t('macros.protein'), eaten: Math.round(totals.proteinG), target: goal.prot },
    { label: t('macros.fat'), eaten: Math.round(totals.fatG), target: goal.fat },
    { label: t('macros.carbs'), eaten: Math.round(totals.carbG), target: goal.carb },
  ];
  return (
    <Card style={styles.dayCard}>
      <View style={styles.dayHead}>
        <Text style={[styles.dayTitle, { color: theme.text }, theme.font.bodySemiBold]}>{t('food.day.title')}</Text>
        {goal.hideCalories ? null : onPlan ? (
          <Text style={[styles.dayChip, { color: theme.accent }, theme.font.bodyMedium]}>{t('food.day.onPlan')}</Text>
        ) : (
          <Text style={[styles.dayChip, { color: theme.subtle }, theme.font.body]}>{t('food.day.over')}</Text>
        )}
      </View>
      {goal.hideCalories ? null : (
        <>
          <Text style={[styles.dayKcal, { color: theme.text }, theme.font.bodyMedium]}>
            {t(approx ? 'food.day.kcalApprox' : 'food.day.kcal', { eaten: kcalEaten, target })}
          </Text>
          <Bar value={kcalEaten} max={target} color={theme.primary} track={theme.fill} height={8} />
          <Text style={[styles.dayWorkout, { color: theme.subtle }, theme.font.body]}>{parts.join(' · ')}</Text>
          {noMovementYet ? (
            <Pressable onPress={() => router.push('/activity')} hitSlop={6}>
              <Text style={[styles.dayWorkout, { color: theme.subtle }, theme.font.body]}>
                {t('food.day.noMovement')}{' '}
                <Text style={[styles.dayMoveLink, { color: theme.primary }]}>{t('food.day.noMovementCta')}</Text>
              </Text>
            </Pressable>
          ) : null}
          {approx ? (
            <Text style={[styles.dayWorkout, { color: theme.subtle }, theme.font.body]}>
              {t('food.day.forecastNote')}
            </Text>
          ) : null}
          <Pressable onPress={() => router.push('/more/how-it-works')} hitSlop={6}>
            <Text style={[styles.dayHowLink, { color: theme.tertiary }, theme.font.body]}>{t('food.day.how')}</Text>
          </Pressable>
        </>
      )}
      <View style={styles.macroRow}>
        {macros.map((m) => (
          <View key={m.label} style={styles.macroCol}>
            <Text style={[styles.macroLabel, { color: theme.subtle }, theme.font.body]}>
              {m.label} {m.eaten}/{m.target}
            </Text>
            <Bar value={m.eaten} max={m.target} color={theme.accent} track={theme.fill} height={5} />
          </View>
        ))}
      </View>
    </Card>
  );
}

/// The day's micronutrient intake against the reference norms, with a fill bar
/// per nutrient (norm tick + upper-limit tick). Honest by construction: a bar
/// appears ONLY for nutrients the day's foods actually measured — nothing is
/// shown as zero-when-unknown, and the coverage line says how many meals had
/// data at all. Collapsed by default so it never crowds the day view.
function MicroDay({
  micros,
  sex,
  open,
  onToggle,
  theme,
}: {
  micros: MicroTotals;
  sex: '' | Sex;
  open: boolean;
  onToggle: () => void;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const measured = dailyMicroNorms(sex)
    .map((row) => ({ row, intake: microIntake(micros, row) }))
    .filter((x): x is { row: MicroRow; intake: number } => x.intake != null);
  const summary = measured.length > 0 ? t('food.micros.count', { n: measured.length }) : t('food.micros.none');

  return (
    <Card style={styles.dayCard}>
      <Pressable onPress={onToggle} style={styles.microHead} hitSlop={6}>
        {/* Title shrinks, counter never wraps — «измерено: 8» used to fold into a
            per-letter column when the long title ate the row (device screenshot). */}
        <Text
          style={[styles.dayTitle, styles.microTitle, { color: theme.text }, theme.font.bodySemiBold]}
          numberOfLines={1}
        >
          {t('food.micros.title')}
        </Text>
        <Text style={[styles.microSummary, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
          {summary}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tertiary} />
      </Pressable>
      {open ? (
        measured.length === 0 ? (
          <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>{t('food.micros.empty')}</Text>
        ) : (
          <View style={styles.microBody}>
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>
              {t('food.micros.coverage', { withData: micros.entriesWithData, total: micros.entriesTotal })}
            </Text>
            {sex !== 'male' && sex !== 'female' ? (
              <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>{t('food.micros.needSex')}</Text>
            ) : null}
            {(['vitamin', 'mineral'] as const).map((group) => {
              const rows = measured.filter((x) => x.row.group === group);
              if (rows.length === 0) return null;
              return (
                <View key={group} style={styles.microGroup}>
                  <Text style={[styles.microGroupHeading, { color: theme.subtle }, theme.font.bodySemiBold]}>
                    {t(`weight.micros.groups.${group}`)}
                  </Text>
                  {rows.map(({ row, intake }) => {
                    const pct = row.value > 0 ? Math.round((intake / row.value) * 100) : 0;
                    return (
                      <View key={row.key} style={styles.microRow}>
                        <View style={styles.microRowHead}>
                          <Text style={[styles.microName, { color: theme.text }, theme.font.body]}>
                            {t(`weight.micros.name.${row.key}`)}
                          </Text>
                          <Text style={[styles.microVal, { color: theme.subtle }, theme.font.body]}>
                            {fmtIntake(row, intake)} {t(`weight.micros.unit.${row.unit}`)} ·{' '}
                            {t('food.micros.ofNorm', { pct })}
                          </Text>
                        </View>
                        <FillBar value={intake} min={row.value} max={row.limit} thickness={8} />
                      </View>
                    );
                  })}
                </View>
              );
            })}
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>
              {t('food.micros.coverageNote')}
            </Text>
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>{t('food.micros.normsHint')}</Text>
          </View>
        )
      ) : null}
    </Card>
  );
}

/// The day's intake for one norm row, or null when today's foods measured none
/// of it (so the caller shows no bar rather than an implied zero).
function microIntake(micros: MicroTotals, row: MicroRow): number | null {
  const src = (row.group === 'mineral' ? micros.minerals : micros.vitamins) as Record<string, number | undefined>;
  const v = src[row.key];
  return typeof v === 'number' && v > 0 ? v : null;
}

/// Whole numbers read cleanly for µg and minerals; sub-mg vitamins keep 1 dp.
function fmtIntake(row: MicroRow, v: number): string {
  return row.group === 'vitamin' && row.unit === 'mg' ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString();
}

function Bar({
  value,
  max,
  color,
  track,
  height,
}: {
  value: number;
  max: number;
  color: string;
  track: string;
  height: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <View style={[styles.barTrack, { backgroundColor: track, height, borderRadius: height / 2 }]}>
      <View style={{ width: `${pct}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  add: { marginTop: 4, marginBottom: 12 },
  repeatAck: { fontSize: 13, textAlign: 'center', marginBottom: 10 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { gap: 22 },
  group: { gap: 10 },
  mealHeadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    borderBottomWidth: 1,
    paddingBottom: 6,
    marginBottom: 2,
  },
  mealHead: { fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.6 },
  mealSum: { fontSize: 12 },
  row: {},
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowText: { fontSize: 15, flex: 1 },
  rowTime: { fontSize: 12 },
  repeatBtn: { marginLeft: 2 },
  rowMacros: { fontSize: 13, marginTop: 4, lineHeight: 19 },
  dayCard: { marginBottom: 16 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dayTitle: { fontSize: 15 },
  dayChip: { fontSize: 12 },
  dayKcal: { fontSize: 14, marginBottom: 6 },
  dayWorkout: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  dayMoveLink: { textDecorationLine: 'underline' },
  dayHowLink: { fontSize: 12, marginTop: 6, textDecorationLine: 'underline' },
  macroRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  macroCol: { flex: 1 },
  macroLabel: { fontSize: 11, marginBottom: 4 },
  barTrack: { overflow: 'hidden', width: '100%' },
  microHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The TITLE flexes/truncates; the counter keeps its intrinsic width so
  // «измерено: N» is always whole (it used to get squeezed into a letter
  // column by the greedy title).
  microTitle: { flex: 1 },
  microSummary: { fontSize: 13 },
  microBody: { marginTop: 12 },
  microGroup: { marginTop: 10 },
  microGroupHeading: { fontSize: 12, marginBottom: 4 },
  microRow: { marginBottom: 12 },
  microRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 8 },
  microName: { fontSize: 13, flexShrink: 1 },
  microVal: { fontSize: 12, textAlign: 'right' },
  microNote: { fontSize: 12, marginTop: 8, lineHeight: 17 },
});
