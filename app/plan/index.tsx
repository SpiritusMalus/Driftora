import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { macroTotalsByDay } from '@/lib/core/db/food';
import type { WeightRow } from '@/lib/core/db/schema';
import { ensureSettings, updateSettings, type SettingsPatch } from '@/lib/core/db/settings';
import { dayKey, listStepsDays, typicalSteps } from '@/lib/core/db/steps';
import { latestDeviceBodyFat, listWeights } from '@/lib/core/db/weight';
import { todayWorkoutKcal } from '@/lib/core/db/workouts';
import {
  ADAPTIVE_WINDOW_DAYS,
  averageEarnedKcal,
  bmrFactorFromMeasured,
  looksUnderLogged,
  measuredExpenditure,
  type EarnedDay,
  type MeasuredExpenditure,
} from '@/lib/core/insights/adaptiveExpenditure';
import {
  DEFICIT_TEMPOS,
  GOAL_MODES,
  bmiValue,
  dayBudgetKcal,
  stepsEarnedKcal,
  suggestPlan,
  validBmrFactor,
  type DeficitTempo,
  type GoalMode,
  type Sex,
} from '@/lib/core/insights/bodyMetrics';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// «План питания» — the CONFIGURATION half of what used to be the weight screen
/// (2026-08-22: «прям нагромождено всё»). The rule the app now follows: a
/// section screen carries one object in one order (hero → input → meaning →
/// history), and everything you touch once a month lives here instead.
///
/// The order on this screen is the order of the thought: what I want (goal,
/// tempo, goal weight) → what that gives (kcal + macros, one tap to make it the
/// day's target) → the reality check against my own data (measured burn) → the
/// inputs it all stands on (body parameters) → the manual override.
///
/// UX rule kept from the weight screen (2026-07-03 «не понятно что нажимать»,
/// 2026-07-09 «бесит автосейв на каждый ввод»): the PLAN LEVERS persist the
/// moment they're edited with a visible «✓»; the BODY FACTS are read-only here
/// and edited in the body-setup wizard, which saves everything once.
export default function PlanScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();

  const [latestKg, setLatestKg] = useState(0);
  const [deviceFat, setDeviceFat] = useState<WeightRow | null>(null);
  // The device-free «real burn» measured from the weight trend + food log — the
  // honest reality-check next to the formula's estimate. Null until there's
  // enough consistent data (see measuredExpenditure's gates).
  const [expenditure, setExpenditure] = useState<MeasuredExpenditure | null>(null);
  // «Как обычно у вас» — the median daily step count (≥3 recorded days), used to
  // answer the PLANNING question right on this screen: the resting base is not
  // the whole day, so say what the user's usual walking actually adds to it.
  const [usualSteps, setUsualSteps] = useState<number | null>(null);

  // Body profile + КБЖУ targets (single app_settings row). Body facts are
  // display-only here (edited in the wizard); plan levers persist on edit.
  const [heightText, setHeightText] = useState('');
  const [sex, setSex] = useState<'' | Sex>('');
  const [birthYearText, setBirthYearText] = useState('');
  const [goalMode, setGoalMode] = useState<GoalMode>('maintain');
  const [deficitTempo, setDeficitTempo] = useState<DeficitTempo>('standard');
  const [goalWeightText, setGoalWeightText] = useState('');
  const [bodyFatText, setBodyFatText] = useState('');
  // Waist is entered in the body-setup wizard; the plan only needs the stored
  // value so its BMR matches Home / the food day.
  const [waistCm, setWaistCm] = useState(0);
  // Adaptive BMR factor (0 = not applied). Set from the «real burn» card below.
  const [bmrFactor, setBmrFactor] = useState(0);
  const [kcal, setKcal] = useState('2000');
  const [protein, setProtein] = useState('120');
  const [fat, setFat] = useState('70');
  const [carb, setCarb] = useState('200');
  // Transient «Сохранено ✓» after any auto-save, shown WHERE the edit happened.
  // 'burn' is the measured-expenditure card's own address: routing its ticks
  // through 'plan' lit the plan card's header too — two ✓ for one tap.
  const [ack, setAck] = useState<{ where: 'plan' | 'manual' | 'burn'; text: string } | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [openBody, setOpenBody] = useState(false);
  const [openManual, setOpenManual] = useState(false);
  // The plan card's explanatory grey text folds away by default (user feedback
  // 2026-07-07: «текста очень много серым»); numbers + one action stay visible.
  const [openPlanWhy, setOpenPlanWhy] = useState(false);

  useEffect(
    () => () => {
      if (ackTimer.current) clearTimeout(ackTimer.current);
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const s = await ensureSettings(db);
        if (!active) return;
        // Weigh-ins are SYNCED on «Весе» (that screen owns the scale import);
        // here they are only read — the plan follows the latest number.
        const list = await listWeights(db, 30);
        if (!active) return;
        setLatestKg(list.length > 0 ? list[0].weightKg : 0);
        setDeviceFat(await latestDeviceBodyFat(db));
        if (!active) return;
        // Adaptive «real burn»: intake (last ADAPTIVE_WINDOW_DAYS) vs the weight
        // trend. Null-safe — measuredExpenditure hides itself until the data is
        // dense enough to be honest.
        const totalsByDay = await macroTotalsByDay(db, ADAPTIVE_WINDOW_DAYS);
        if (!active) return;
        const intake = [...totalsByDay].map(([date, m]) => ({ date, kcal: m.kcal }));
        const weightPts = list.map((w) => ({ date: w.date, kg: w.weightKg }));
        setExpenditure(measuredExpenditure(intake, weightPts));
        setUsualSteps(await typicalSteps(db));
        if (!active) return;
        // Settings re-read on EVERY focus: body facts are edited in the
        // body-setup wizard, so returning from it must show the fresh save.
        setHeightText(s.heightCm > 0 ? String(s.heightCm) : '');
        setSex(s.sex);
        setBirthYearText(s.birthYear > 0 ? String(s.birthYear) : '');
        setGoalMode(s.goalMode);
        setDeficitTempo(s.deficitTempo);
        setGoalWeightText(s.goalWeightKg > 0 ? String(s.goalWeightKg) : '');
        setBodyFatText(s.bodyFatPct > 0 ? String(s.bodyFatPct) : '');
        setWaistCm(s.waistCm);
        setBmrFactor(s.bmrFactor);
        setKcal(String(s.targetKcal));
        setProtein(String(s.targetProteinG));
        setFat(String(s.targetFatG));
        setCarb(String(s.targetCarbG));
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  /// Persist a settings patch immediately and flash the «✓» tick at `where`.
  async function persist(patch: SettingsPatch, ackText: string, where: 'plan' | 'manual' | 'burn') {
    if (!db) return;
    await updateSettings(db, patch);
    setAck({ where, text: ackText });
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => setAck(null), 2500);
  }

  /// «Использовать мой обмен»: turn the measured expenditure into a stored BMR
  /// factor so the budget rides the user's real energy balance, not a formula.
  /// Only offered at 'good' confidence (dense enough data). Subtracts the window's
  /// average earned movement so the resting base isn't double-counted with the
  /// per-day «шаги +N». Passing 0 as bmrFactor to the profile probe gives the
  /// UN-calibrated formula BMR to divide by.
  async function applyMeasuredBurn() {
    if (!db || expenditure == null || expenditure.confidence !== 'good') return;
    const formula = suggestPlan({ ...profile, bmrFactor: 0 }, latestKg, 'maintain');
    if (formula == null) return;
    // Belt-and-braces: never calibrate onto a number that implies missed meals.
    if (looksUnderLogged(expenditure.kcalPerDay, formula.bmrKcal)) return;
    const stepsRows = await listStepsDays(db, ADAPTIVE_WINDOW_DAYS + 2);
    const stepsByDate = new Map(stepsRows.map((r) => [r.date, r]));
    // Walk EVERY window day, not only the ones with a steps row: a manual
    // workout log never creates a steps row, and a user without step
    // permission has none at all — their workouts would otherwise vanish from
    // avgEarned and be double-counted after calibration (folded into the
    // resting base AND still eaten back per workout day). Days with neither
    // steps nor workouts are still skipped, so partial step history doesn't
    // dilute the average with phantom zero days.
    const dates: string[] = [];
    for (let i = 0; i < ADAPTIVE_WINDOW_DAYS; i++) {
      dates.push(dayKey(new Date(Date.now() - i * 86_400_000)));
    }
    const probed = await Promise.all(
      dates.map(async (date) => {
        const r = stepsByDate.get(date);
        return {
          hasSteps: r != null,
          day: {
            steps: Number(r?.steps ?? 0),
            workoutSteps: Number(r?.workoutSteps ?? 0),
            workoutKcal: await todayWorkoutKcal(db, date),
          },
        };
      }),
    );
    const earned: EarnedDay[] = probed
      .filter((e) => e.hasSteps || e.day.workoutKcal > 0)
      .map((e) => e.day);
    const avgEarned = averageEarnedKcal(earned, latestKg);
    const factor = bmrFactorFromMeasured(expenditure.kcalPerDay, avgEarned, formula.bmrKcal);
    if (factor == null) return;
    await persist({ bmrFactor: factor }, t('weight.burn.appliedTick'), 'burn');
    setBmrFactor(factor);
  }

  const heightCm = toNumber(heightText);
  const bmi = bmiValue(latestKg, heightCm);

  // The plan is a RESTING base (sedentary): the daily budget on «Еда» adds
  // today's steps + workouts on top, so the manual activity multiplier no longer
  // drives the budget (it double-counted steps).
  const profile = {
    sex,
    birthYear: Math.round(toNumber(birthYearText)),
    heightCm,
    activityLevel: 'sedentary' as const,
    bodyFatPct: toNumber(bodyFatText),
    waistCm,
    bmrFactor,
  };
  // Whether the adaptive measurement is currently driving the budget.
  const burnApplied = validBmrFactor(bmrFactor);
  // Probe with a plausible dummy weight: tells "profile incomplete" apart from
  // "no weight logged yet", so the plan card can say exactly what's missing.
  const profileComplete = suggestPlan(profile, 70, 'maintain') != null;
  const goalWeightKg = toNumber(goalWeightText);
  const plan = suggestPlan(profile, latestKg, goalMode, new Date(), goalWeightKg, deficitTempo);
  // A measured burn UNDER the resting BMR means food went unlogged, not that the
  // metabolism is slow — warn instead of offering to calibrate on a diary gap.
  const burnUnderLogged =
    expenditure != null && plan != null && looksUnderLogged(expenditure.kcalPerDay, plan.bmrKcal);
  // ETA copy: short horizons read best in weeks, long ones in months.
  const eta = (() => {
    if (plan?.etaWeeks == null) return null;
    if (plan.etaWeeks < 10) return { key: 'weight.plan.etaWeeks', n: Math.max(1, plan.etaWeeks) };
    return { key: 'weight.plan.etaMonths', n: Math.max(1, Math.round(plan.etaWeeks / 4.345)) };
  })();
  // PLANNING, not a promise: what the user's OWN usual walking adds to the
  // resting base — the same formula the day budget uses (stepsEarnedKcal), so
  // this number and the food day's «шаги +N» can never disagree. Shown only
  // when it actually moves the day (usual steps above the ~3000 resting
  // baseline) and a weight exists to price them with.
  const usualStepsKcal =
    plan != null && usualSteps != null && latestKg > 0 ? stepsEarnedKcal(usualSteps, latestKg) : 0;
  const usualDayKcal =
    plan != null && usualStepsKcal > 0 ? dayBudgetKcal(plan.baseKcal, plan.minDayKcal, usualStepsKcal) : 0;
  const planApplied =
    plan != null &&
    toNumber(kcal) === plan.kcal &&
    toNumber(protein) === plan.prot &&
    toNumber(fat) === plan.fat &&
    toNumber(carb) === plan.carb;

  const bodySummary = profileComplete
    ? [`${Math.round(heightCm)} ${t('weight.heightUnit')}`, sex ? t(`weight.formula.${sex}`) : '', birthYearText]
        .filter(Boolean)
        .join(' · ')
    : t('weight.sections.body.empty');

  const manualSummary = t('weight.sections.manual.summary', {
    kcal: Math.round(toNumber(kcal)),
    prot: Math.round(toNumber(protein)),
    fat: Math.round(toNumber(fat)),
    carb: Math.round(toNumber(carb)),
  });

  return (
    <Screen>
      {/* Where the plan stands: the weight it is computed from, one tap back to
          the screen that owns that number. The two screens are one loop —
          взвесился → план пересчитался. */}
      <Pressable onPress={() => router.push('/weight')} hitSlop={6} style={styles.fromRow}>
        <Text style={[styles.fromText, { color: theme.subtle }, theme.font.body]}>
          {latestKg > 0
            ? t('planScreen.fromWeight', { kg: latestKg.toFixed(1) })
            : t('planScreen.noWeight')}
        </Text>
        <Ionicons name="chevron-forward" size={14} color={theme.tertiary} />
      </Pressable>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.dbUnavailable')}</Text>
      ) : (
        <>
          {/* ── 1. What I want → what that gives. One tap makes it the food
                 diary's goal. ── */}
          <Card style={styles.card}>
            <View style={styles.titleRow}>
              <Text style={[styles.cardTitle, { color: theme.text }, theme.font.bodySemiBold]}>
                {t('weight.plan.title')}
              </Text>
              {ack?.where === 'plan' ? (
                <Text style={[styles.ackTick, { color: theme.accent }, theme.font.bodyMedium]}>{ack.text}</Text>
              ) : null}
            </View>
            <ChipRow>
              {GOAL_MODES.map((m) => (
                <Chip
                  key={m}
                  label={t(`weight.plan.mode.${m}`)}
                  selected={goalMode === m}
                  onPress={() => {
                    setGoalMode(m);
                    void persist({ goalMode: m }, t('weight.targets.savedTick'), 'plan');
                  }}
                />
              ))}
            </ChipRow>

            {/* Pace tempo — the ONE speed lever. For lose it sizes the deficit
                (soft −10% / standard −15…−20% / fast −25%), for gain the surplus
                (+5% / +10% / +15%); «standard» keeps the pre-lever default. The
                implied kg/week shows live in the intro line below, and the
                clinical floor still caps a fast deficit. */}
            {goalMode !== 'maintain' ? (
              <>
                <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>
                  {t(goalMode === 'lose' ? 'weight.plan.tempo.label' : 'weight.plan.tempoGain.label')}
                </Text>
                <ChipRow>
                  {DEFICIT_TEMPOS.map((tp) => (
                    <Chip
                      key={tp}
                      label={t(`weight.plan.${goalMode === 'lose' ? 'tempo' : 'tempoGain'}.${tp}`)}
                      selected={deficitTempo === tp}
                      onPress={() => {
                        setDeficitTempo(tp);
                        void persist({ deficitTempo: tp }, t('weight.targets.savedTick'), 'plan');
                      }}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}

            {/* Goal weight — the deficit's protein basis (жировой массе белок не
                нужен) and the honest "до цели ≈ …" line. Only for lose/gain:
                maintain has no destination. Autosaved on end-editing. */}
            {goalMode !== 'maintain' ? (
              <View style={styles.heightRow}>
                <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>
                  {t('weight.plan.goalWeight')}
                </Text>
                <TextField
                  value={goalWeightText}
                  onChangeText={setGoalWeightText}
                  onEndEditing={() =>
                    void persist({ goalWeightKg: toNumber(goalWeightText) }, t('weight.targets.savedTick'), 'plan')
                  }
                  keyboardType="numeric"
                  style={styles.heightInput}
                />
                <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.unit')}</Text>
              </View>
            ) : null}

            {plan != null ? (
              <>
                <Text style={[styles.planIntro, { color: theme.text }, theme.font.body]}>
                  {t(`weight.plan.intro.${plan.mode}`, {
                    kg: latestKg.toFixed(1),
                    pace: plan.paceKgPerWeek.toFixed(1),
                  })}
                </Text>
                <Text style={[styles.planKcal, { color: theme.heroAccent }, theme.font.heading]}>
                  {t('weight.plan.kcalPerDay', { kcal: plan.kcal })}
                </Text>
                <View style={styles.macroRow}>
                  {(
                    [
                      [t('macros.protein'), plan.prot],
                      [t('macros.fat'), plan.fat],
                      [t('macros.carbs'), plan.carb],
                    ] as const
                  ).map(([label, grams]) => (
                    <View key={label} style={[styles.macroTile, { backgroundColor: theme.fill }]}>
                      <Text style={[styles.macroLabel, { color: theme.subtle }, theme.font.body]}>{label}</Text>
                      <Text style={[styles.macroValue, { color: theme.text }, theme.font.bodySemiBold]}>
                        {grams} {t('units.g')}
                      </Text>
                    </View>
                  ))}
                </View>
                {/* The plan is a RESTING base — steps + workouts add on «Еда». Say so
                    right under the number so it never reads as the whole budget. */}
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                  {t('weight.plan.restNote')}
                </Text>
                {/* The planning answer in numbers: «а сколько будет, если я
                    пройду свои обычные шаги?» — usual median steps priced by
                    the SAME formula as the day budget, so plan and day agree. */}
                {usualStepsKcal > 0 ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t('weight.plan.usualStepsLine', {
                      steps: formatStepCount(usualSteps ?? 0),
                      kcal: usualStepsKcal,
                      total: usualDayKcal,
                    })}
                  </Text>
                ) : null}
                {/* Birth year missing → the plan is shown as an estimate on a
                    neutral adult age; say so plainly and point to the fix. Stays
                    VISIBLE (not folded) so the number never looks more certain
                    than it is. */}
                {plan.assumedAge ? (
                  <Text style={[styles.assumedAge, { color: theme.accent }, theme.font.bodyMedium]}>
                    {t('weight.plan.assumedAge')}
                  </Text>
                ) : null}
                {/* At high BMI Mifflin systematically OVERestimates (it treats
                    metabolically-quiet fat as active). If no composition is known,
                    point at the one-minute tape fix — visible, since the number is
                    the least reliable exactly here. */}
                {plan.bmrMethod === 'mifflin' && bmi != null && bmi >= 30 ? (
                  <Pressable onPress={() => router.push('/body-setup?step=waist')} hitSlop={6}>
                    <Text style={[styles.assumedAge, { color: theme.accent }, theme.font.bodyMedium]}>
                      {t('weight.plan.overestimateNudge')}
                    </Text>
                  </Pressable>
                ) : null}
                {/* Kept visible: the motivating countdown and the safety floor. */}
                {eta != null ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t(eta.key, { goal: toNumber(goalWeightText), n: eta.n })}
                  </Text>
                ) : null}
                {plan.floored ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t('weight.plan.floored', { kcal: plan.minDayKcal })}
                  </Text>
                ) : null}
                {planApplied ? (
                  <Text style={[styles.appliedLine, { color: theme.accent }, theme.font.bodyMedium]}>
                    {t('weight.plan.applied')}
                  </Text>
                ) : (
                  <Pressable
                    onPress={() => {
                      setKcal(String(plan.kcal));
                      setProtein(String(plan.prot));
                      setFat(String(plan.fat));
                      setCarb(String(plan.carb));
                      // One tap = the numbers land in the targets AND are saved.
                      // `targetsSetAt` marks this as a DELIBERATE goal — the food
                      // screen shows day progress only after that.
                      void persist(
                        {
                          targetKcal: plan.kcal,
                          targetProteinG: plan.prot,
                          targetFatG: plan.fat,
                          targetCarbG: plan.carb,
                          targetsSetAt: Date.now(),
                        },
                        t('weight.plan.appliedTick'),
                        'plan',
                      );
                    }}
                    style={({ pressed }) => [styles.applyBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <Text style={[styles.applyText, { color: theme.primary }, theme.font.bodySemiBold]}>
                      {t('weight.plan.apply')}
                    </Text>
                  </Pressable>
                )}
                {/* All the explanatory prose folds under one toggle — the card
                    stays "numbers + one action" until the reader wants the why.
                    protBasis lives here on purpose: it IS the answer to «почему
                    белка меньше», which is exactly what this toggle promises. */}
                <Pressable onPress={() => setOpenPlanWhy((v) => !v)} style={styles.whyToggle} hitSlop={6}>
                  <Text style={[styles.whyToggleText, { color: theme.primary }, theme.font.body]}>
                    {openPlanWhy ? t('weight.plan.whyHide') : t('weight.plan.why')}
                  </Text>
                  <Ionicons name={openPlanWhy ? 'chevron-up' : 'chevron-down'} size={14} color={theme.primary} />
                </Pressable>
                {openPlanWhy ? (
                  <View style={styles.whyBody}>
                    {/* BMR first — the number a doctor / external calculator
                        would name. Users compared those against the budget's
                        «база» (BMR × 1.2, goal-adjusted) and read the mismatch
                        as a wrong formula; naming both kills the confusion. */}
                    <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                      {t('weight.plan.bmrLine', {
                        kcal: plan.bmrKcal,
                        method: t(`weight.plan.bmrMethod.${plan.bmrMethod}`),
                      })}
                    </Text>
                    {/* Energy breakdown — the answer to «2540 кажется мало»: the
                        target is maintenance MINUS a deficit, not «сколько нужно». */}
                    <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                      {t('weight.plan.maintenanceLine', { maintenance: plan.maintenanceKcal })}
                    </Text>
                    {plan.mode !== 'maintain' && plan.maintenanceKcal > 0 ? (
                      <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                        {t(`weight.plan.deltaLine.${plan.mode}`, {
                          kcal: plan.kcal,
                          pct: Math.abs(Math.round((plan.kcal / plan.maintenanceKcal - 1) * 100)),
                        })}
                      </Text>
                    ) : null}
                    {plan.proteinBasis !== 'current' ? (
                      <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                        {t(`weight.plan.protBasis.${plan.proteinBasis}`, { kg: plan.proteinBasisKg })}
                      </Text>
                    ) : null}
                    <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                      {t('weight.plan.fiber', { g: plan.fiber })}
                    </Text>
                    <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                      {t('weight.plan.recalc')} {t('weight.targets.note')}
                    </Text>
                    <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>
                      {t('weight.plan.note')}
                    </Text>
                    <Pressable onPress={() => router.push('/more/how-it-works')} hitSlop={6} style={styles.whyToggle}>
                      <Text style={[styles.whyToggleText, { color: theme.primary }, theme.font.body]}>
                        {t('howItWorks.linkTitle')}
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={theme.primary} />
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : (
              <>
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                  {profileComplete ? t('weight.plan.needWeight') : t('weight.plan.needProfile')}
                </Text>
                <Pressable
                  onPress={() => router.push(profileComplete ? '/weight' : '/body-setup')}
                  style={({ pressed }) => [styles.applyBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.applyText, { color: theme.primary }, theme.font.bodySemiBold]}>
                    {profileComplete ? t('planScreen.logWeightCta') : t('weight.plan.setupCta')}
                  </Text>
                </Pressable>
              </>
            )}
          </Card>

          {/* ── 2. The reality check: the same number measured from YOUR data
                 instead of a formula. Shown only once the data is dense enough
                 (measuredExpenditure gates it). ── */}
          {expenditure != null ? (
            <Card style={styles.card}>
              <View style={styles.burnTitleRow}>
                <Text style={[styles.burnLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
                  {t('weight.burn.title', { days: ADAPTIVE_WINDOW_DAYS }).toUpperCase()}
                </Text>
                {/* The tick lives in THIS card's header for apply and reset both
                    — the branch below changes with bmrFactor, so an in-branch
                    tick would vanish with the state it acknowledges. */}
                {ack?.where === 'burn' ? (
                  <Text style={[styles.ackTick, { color: theme.accent }, theme.font.bodyMedium]}>{ack.text}</Text>
                ) : null}
              </View>
              <Text style={[styles.planKcal, { color: theme.heroAccent }, theme.font.heading]}>
                {t('weight.burn.value', { kcal: expenditure.kcalPerDay })}
              </Text>
              <Text style={[styles.burnSub, { color: theme.subtle }, theme.font.body]}>
                {t('weight.burn.caption')}
              </Text>
              <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                {t(expenditure.weightSlopeKgPerWeek === 0 ? 'weight.burn.explainFlat' : 'weight.burn.explain', {
                  intake: expenditure.avgIntakeKcal,
                  trend: Math.abs(expenditure.weightSlopeKgPerWeek).toFixed(2),
                  dir: t(expenditure.weightSlopeKgPerWeek < 0 ? 'weight.burn.dirDown' : 'weight.burn.dirUp'),
                })}
              </Text>
              {expenditure.confidence === 'ok' ? (
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('weight.burn.early')}</Text>
              ) : null}
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>
                {t('weight.burn.note')}
              </Text>
              {/* Opt-in, never silent: the user decides to let the measurement drive
                  the budget (mirrors «Использовать измерение весов»). Offered only at
                  'good' confidence; once applied, it says so and can be reset. */}
              {burnUnderLogged ? (
                <Text style={[styles.appliedLine, { color: theme.accent }, theme.font.bodyMedium]}>
                  {t('weight.burn.underLogged')}
                </Text>
              ) : burnApplied ? (
                <>
                  <Text style={[styles.appliedLine, { color: theme.accent }, theme.font.bodyMedium]}>
                    {t('weight.burn.applied')}
                  </Text>
                  <Pressable
                    onPress={() =>
                      void persist({ bmrFactor: 0 }, t('weight.burn.resetTick'), 'burn').then(() => setBmrFactor(0))
                    }
                    hitSlop={6}
                    style={styles.whyToggle}
                  >
                    <Text style={[styles.whyToggleText, { color: theme.primary }, theme.font.body]}>
                      {t('weight.burn.reset')}
                    </Text>
                  </Pressable>
                </>
              ) : expenditure.confidence === 'good' ? (
                <Pressable
                  onPress={() => void applyMeasuredBurn()}
                  style={({ pressed }) => [styles.applyBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={[styles.applyText, { color: theme.primary }, theme.font.bodySemiBold]}>
                    {t('weight.burn.apply')}
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          {/* ── 3. What it all stands on, one quiet line each ── */}
          <Section
            title={t('weight.sections.body.title')}
            summary={bodySummary}
            open={openBody}
            onToggle={() => setOpenBody((v) => !v)}
            theme={theme}
          >
            <ProfileLine
              label={t('weight.height')}
              value={heightCm > 0 ? `${Math.round(heightCm)} ${t('weight.heightUnit')}` : '—'}
              theme={theme}
              onPress={() => router.push('/body-setup?step=height')}
            />
            <ProfileLine
              label={t('weight.formula.sex')}
              value={sex ? t(`weight.formula.${sex}`) : '—'}
              theme={theme}
              onPress={() => router.push('/body-setup?step=sex')}
            />
            <ProfileLine
              label={t('weight.formula.birthYear')}
              value={birthYearText || '—'}
              theme={theme}
              onPress={() => router.push('/body-setup?step=birthYear')}
            />
            <ProfileLine
              label={t('weight.formula.bodyFat')}
              value={bodyFatText ? `${bodyFatText}%` : t('weight.sections.body.fatUnset')}
              theme={theme}
              onPress={() => router.push('/body-setup?step=bodyFat')}
            />
            {/* Waist — the device-free composition input; surfaced here so it's
                visible and one tap from editing, not buried in the wizard. */}
            <ProfileLine
              label={t('weight.formula.waist')}
              value={waistCm > 0 ? `${Math.round(waistCm)} ${t('weight.heightUnit')}` : t('weight.sections.body.waistUnset')}
              theme={theme}
              onPress={() => router.push('/body-setup?step=waist')}
            />
            {/* Scale-measured body fat NEVER feeds BMR silently — the plan uses
                app_settings.bodyFatPct only, and this explicit tap is the single
                bridge between the measurement and the calculation. */}
            {deviceFat?.bodyFatPct != null
              ? (() => {
                  const measured = Math.round((deviceFat.bodyFatPct as number) * 10) / 10;
                  const applied = toNumber(bodyFatText) === measured;
                  return (
                    <>
                      <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                        {t('weight.deviceFat.line', {
                          pct: measured.toFixed(1),
                          date: formatDay(deviceFat.date),
                        })}
                      </Text>
                      {applied ? (
                        <Text style={[styles.appliedLine, { color: theme.accent }, theme.font.bodyMedium]}>
                          {t('weight.deviceFat.applied')}
                        </Text>
                      ) : (
                        <Pressable
                          onPress={() => {
                            setBodyFatText(String(measured));
                            void persist({ bodyFatPct: measured }, t('weight.targets.savedTick'), 'plan');
                          }}
                          style={({ pressed }) => [
                            styles.applyBtn,
                            { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 },
                          ]}
                        >
                          <Text style={[styles.applyText, { color: theme.primary }, theme.font.bodySemiBold]}>
                            {t('weight.deviceFat.apply')}
                          </Text>
                        </Pressable>
                      )}
                    </>
                  );
                })()
              : null}
            <Pressable
              onPress={() => router.push('/body-setup')}
              style={({ pressed }) => [styles.applyBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.applyText, { color: theme.primary }, theme.font.bodySemiBold]}>
                {t('weight.sections.body.edit')}
              </Text>
            </Pressable>
          </Section>

          {/* ── 4. The manual override, last: it exists for the people who
                 already know their numbers. ── */}
          <Section
            title={t('weight.sections.manual.title')}
            summary={manualSummary}
            open={openManual}
            onToggle={() => setOpenManual((v) => !v)}
            ack={ack?.where === 'manual' ? ack.text : null}
            theme={theme}
          >
            <Field
              label={t('settings.targetKcal')}
              value={kcal}
              onChange={setKcal}
              onDone={() =>
                void persist({ targetKcal: toNumber(kcal), targetsSetAt: Date.now() }, t('weight.targets.savedTick'), 'manual')
              }
              theme={theme}
            />
            <Field
              label={t('settings.targetProtein')}
              value={protein}
              onChange={setProtein}
              onDone={() =>
                void persist(
                  { targetProteinG: toNumber(protein), targetsSetAt: Date.now() },
                  t('weight.targets.savedTick'),
                  'manual',
                )
              }
              theme={theme}
            />
            <Field
              label={t('settings.targetFat')}
              value={fat}
              onChange={setFat}
              onDone={() =>
                void persist({ targetFatG: toNumber(fat), targetsSetAt: Date.now() }, t('weight.targets.savedTick'), 'manual')
              }
              theme={theme}
            />
            <Field
              label={t('settings.targetCarb')}
              value={carb}
              onChange={setCarb}
              onDone={() =>
                void persist({ targetCarbG: toNumber(carb), targetsSetAt: Date.now() }, t('weight.targets.savedTick'), 'manual')
              }
              theme={theme}
            />
            <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('weight.targets.note')}</Text>
          </Section>
        </>
      )}
    </Screen>
  );
}

/// A card that folds to a single line: title + live one-line summary + chevron.
/// The summary carries the useful number, so opening is usually unnecessary —
/// «заполнил раз — больше не мозолит глаза».
function Section({
  title,
  summary,
  open,
  onToggle,
  ack,
  children,
  theme,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  ack?: string | null;
  children: ReactNode;
  theme: Theme;
}) {
  return (
    <Card style={styles.sectionCard}>
      <Pressable onPress={onToggle} style={styles.sectionHeader} hitSlop={6}>
        <Text style={[styles.sectionTitle, { color: theme.text }, theme.font.bodySemiBold]}>{title}</Text>
        <Text
          numberOfLines={1}
          style={[styles.sectionSummary, { color: ack ? theme.accent : theme.subtle }, theme.font.body]}
        >
          {ack ?? summary}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tertiary} />
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </Card>
  );
}

function Field({
  label,
  value,
  onChange,
  onDone,
  theme,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onDone: () => void;
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      <TextField value={value} onChangeText={onChange} onEndEditing={onDone} keyboardType="numeric" />
    </View>
  );
}

/// One body fact: label left, value right. With `onPress` it becomes a shortcut
/// straight to that question in the wizard (`/body-setup?step=…`), so changing
/// one value is tap → type → save, not a walk through the whole flow.
function ProfileLine({
  label,
  value,
  theme,
  onPress,
}: {
  label: string;
  value: string;
  theme: Theme;
  onPress?: () => void;
}) {
  const inner = (
    <>
      <Text style={[styles.lineName, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      <Text style={[styles.lineValue, { color: theme.text }, theme.font.bodySemiBold]}>{value}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={14} color={theme.tertiary} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.line, { borderBottomColor: theme.separator, opacity: pressed ? 0.6 : 1 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={[styles.line, { borderBottomColor: theme.separator }]}>{inner}</View>;
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/// '2026-06-17' → '17.06.2026'.
function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/// Group thousands using the locale separator: 8400 → '8 400'.
function formatStepCount(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

const styles = StyleSheet.create({
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginBottom: 14, alignSelf: 'flex-start' },
  fromText: { fontSize: 13 },
  card: { marginBottom: 16 },
  note: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16 },
  ackTick: { fontSize: 13 },
  planIntro: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  assumedAge: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  planKcal: { fontSize: 28, lineHeight: 32, marginTop: 8, marginBottom: 10 },
  burnLabel: { fontSize: 12, letterSpacing: 1.44, marginBottom: 2 },
  // No extra bottom margin (unlike titleRow): the caps label keeps its own
  // tight 2px gap to the hero number below.
  burnTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  burnSub: { fontSize: 13, lineHeight: 18, marginTop: -4, marginBottom: 8 },
  macroRow: { flexDirection: 'row', gap: 8 },
  macroTile: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  macroLabel: { fontSize: 11 },
  macroValue: { fontSize: 15, marginTop: 2 },
  appliedLine: { fontSize: 14, marginTop: 12 },
  heightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: 2 },
  heightInput: { flex: 1 },
  unit: { fontSize: 15 },
  disclaimer: { fontSize: 11, fontStyle: 'italic', marginTop: 8, lineHeight: 16 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, marginBottom: 5, marginTop: 4 },
  applyBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start', marginTop: 12 },
  applyText: { fontSize: 14 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  whyToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12, alignSelf: 'flex-start' },
  whyToggleText: { fontSize: 13 },
  whyBody: { marginTop: 2 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  lineName: { fontSize: 13, flexShrink: 1, paddingRight: 12 },
  lineValue: { fontSize: 13, textAlign: 'right' },
  sectionCard: { marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 15 },
  sectionSummary: { fontSize: 13, flex: 1, textAlign: 'right' },
  sectionBody: { marginTop: 12 },
});
