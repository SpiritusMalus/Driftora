import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { latestWeight, upsertWeight } from '@/lib/core/db/weight';
import {
  DEFICIT_TEMPOS,
  GOAL_MODES,
  restingPlan,
  type DeficitTempo,
  type GoalMode,
  type MacroPlan,
  type Sex,
} from '@/lib/core/insights/bodyMetrics';
import {
  birthYearValid,
  bodyFatValid,
  goalWeightValid,
  heightValid,
  setupSteps,
  weightValid,
  type SetupStep,
} from '@/lib/core/insights/bodySetup';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// «Настройка тела» — the guided, one-question-per-screen path to the daily
/// norm. Everything lives in LOCAL state; nothing is persisted until the single
/// «Рассчитать суточную норму» tap, which saves the profile, logs the weight,
/// applies the plan as the diary goal and shows the result with its breakdown
/// («что это за норма и как её бустить»). Reached from: first run (after the
/// intro slides), the Home setup card, and «Вес» → «Параметры тела» → Изменить.
export default function BodySetupScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();

  const [index, setIndex] = useState(0);
  const [birthYearText, setBirthYearText] = useState('');
  const [sex, setSex] = useState<'' | Sex>('');
  const [heightText, setHeightText] = useState('');
  const [weightText, setWeightText] = useState('');
  const [bodyFatText, setBodyFatText] = useState('');
  // No preselected goal on the first pass — the choice must be deliberate.
  const [goal, setGoal] = useState<GoalMode | null>(null);
  const [goalWeightText, setGoalWeightText] = useState('');
  const [tempo, setTempo] = useState<DeficitTempo>('standard');
  const [plan, setPlan] = useState<MacroPlan | null>(null);
  const [saving, setSaving] = useState(false);
  // The result's «Откуда цифра» breakdown is collapsed by default: the hero
  // number + «записали как цель» is the finish; the derivation is on tap.
  const [howOpen, setHowOpen] = useState(false);

  // Prefill from the stored profile (edit runs); the goal is preselected only
  // when a complete profile says this is an edit, not a first setup.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) return;
      const [s, w] = await Promise.all([ensureSettings(db), latestWeight(db)]);
      if (!active) return;
      if (s.birthYear > 0) setBirthYearText(String(s.birthYear));
      if (s.sex === 'male' || s.sex === 'female') setSex(s.sex);
      if (s.heightCm > 0) setHeightText(String(s.heightCm));
      if (w != null) setWeightText(String(w.weightKg));
      if (s.bodyFatPct > 0) setBodyFatText(String(s.bodyFatPct));
      if (s.goalWeightKg > 0) setGoalWeightText(String(s.goalWeightKg));
      setTempo(s.deficitTempo);
      const complete = (s.sex === 'male' || s.sex === 'female') && s.heightCm >= 100 && s.heightCm <= 250;
      if (complete) setGoal(s.goalMode);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  // While no goal is chosen yet, assume the LONG sequence so the goal step's
  // button honestly reads «Далее» — it collapses to «Рассчитать» the moment
  // «Поддерживать» is picked.
  const steps = setupSteps(goal ?? 'lose');
  const step: SetupStep = steps[Math.min(index, steps.length - 1)];
  const lastInput = index === steps.length - 2;

  const yearNum = Math.round(toNumber(birthYearText));
  const heightNum = toNumber(heightText);
  const weightNum = toNumber(weightText);
  const fatNum = toNumber(bodyFatText);
  const goalWeightNum = toNumber(goalWeightText);

  const stepOk = ((): boolean => {
    switch (step) {
      case 'birthYear':
        return birthYearValid(yearNum);
      case 'sex':
        return sex === 'male' || sex === 'female';
      case 'height':
        return heightValid(heightNum);
      case 'weight':
        return weightValid(weightNum);
      case 'bodyFat':
        return bodyFatValid(fatNum);
      case 'goal':
        return goal != null;
      case 'goalWeight':
        return goalWeightValid(goalWeightNum, weightNum, goal ?? 'maintain');
      default:
        return true;
    }
  })();

  function next() {
    if (!stepOk) return;
    if (lastInput) {
      void calc();
    } else {
      setIndex((i) => i + 1);
    }
  }

  /// The ONE write of the whole wizard: profile + goal + tempo + the computed
  /// plan as the diary target, plus today's weigh-in — then the result screen.
  async function calc() {
    const mode = goal ?? 'maintain';
    const fat = bodyFatValid(fatNum) ? fatNum : 0;
    const goalKg = goalWeightValid(goalWeightNum, weightNum, mode) ? goalWeightNum : 0;
    const p = restingPlan(
      { sex, birthYear: yearNum, heightCm: heightNum, activityLevel: 'sedentary', bodyFatPct: fat },
      weightNum,
      mode,
      new Date(),
      goalKg,
      tempo,
    );
    if (p == null) return; // per-step validation makes this unreachable
    setSaving(true);
    try {
      if (db) {
        await updateSettings(db, {
          birthYear: yearNum,
          sex: sex as Sex,
          heightCm: heightNum,
          bodyFatPct: fat,
          goalMode: mode,
          goalWeightKg: goalKg,
          deficitTempo: tempo,
          targetKcal: p.kcal,
          targetProteinG: p.prot,
          targetFatG: p.fat,
          targetCarbG: p.carb,
          targetsSetAt: Date.now(),
        });
        await upsertWeight(db, new Date(), weightNum);
      }
      setPlan(p);
      setIndex(steps.length - 1);
    } finally {
      setSaving(false);
    }
  }

  // ETA copy mirrors the plan card: short horizons in weeks, long in months.
  const eta = (() => {
    if (plan?.etaWeeks == null) return null;
    if (plan.etaWeeks < 10) return { key: 'weight.plan.etaWeeks', n: Math.max(1, plan.etaWeeks) };
    return { key: 'weight.plan.etaMonths', n: Math.max(1, Math.round(plan.etaWeeks / 4.345)) };
  })();

  const tempoSet = goal === 'gain' ? 'gain' : 'lose';

  return (
    <Screen>
      {step !== 'result' ? (
        <View style={styles.progressRow}>
          {index > 0 ? (
            <Pressable onPress={() => setIndex((i) => Math.max(0, i - 1))} hitSlop={8} style={styles.backLink}>
              <Ionicons name="chevron-back" size={16} color={theme.primary} />
              <Text style={[styles.backText, { color: theme.primary }, theme.font.body]}>{t('bodySetup.back')}</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Text style={[styles.progress, { color: theme.subtle }, theme.font.body]}>
            {t('bodySetup.progress', { i: index + 1, n: steps.length - 1 })}
          </Text>
        </View>
      ) : null}

      {step === 'birthYear' ? (
        <StepCard title={t('bodySetup.birthYear.title')} hint={t('bodySetup.birthYear.hint')} theme={theme}>
          <TextField
            value={birthYearText}
            onChangeText={setBirthYearText}
            keyboardType="numeric"
            placeholder={t('bodySetup.birthYear.placeholder')}
            autoFocus
            onSubmitEditing={next}
          />
          {birthYearText.trim() !== '' && !stepOk ? <Invalid text={t('bodySetup.birthYear.invalid')} theme={theme} /> : null}
        </StepCard>
      ) : null}

      {step === 'sex' ? (
        <StepCard title={t('bodySetup.sex.title')} hint={t('bodySetup.sex.hint')} theme={theme}>
          <View style={styles.chips}>
            {(['male', 'female'] as const).map((s) => (
              <Chip key={s} label={t(`bodySetup.sex.${s}`)} active={sex === s} onPress={() => setSex(s)} theme={theme} />
            ))}
          </View>
        </StepCard>
      ) : null}

      {step === 'height' ? (
        <StepCard title={t('bodySetup.height.title')} theme={theme}>
          <UnitField
            value={heightText}
            onChange={setHeightText}
            unit={t('weight.heightUnit')}
            placeholder={t('bodySetup.height.placeholder')}
            onSubmit={next}
          />
          {heightText.trim() !== '' && !stepOk ? <Invalid text={t('bodySetup.height.invalid')} theme={theme} /> : null}
        </StepCard>
      ) : null}

      {step === 'weight' ? (
        <StepCard title={t('bodySetup.weight.title')} hint={t('bodySetup.weight.hint')} theme={theme}>
          <UnitField
            value={weightText}
            onChange={setWeightText}
            unit={t('weight.unit')}
            placeholder={t('bodySetup.weight.placeholder')}
            onSubmit={next}
          />
          {weightText.trim() !== '' && !stepOk ? <Invalid text={t('bodySetup.weight.invalid')} theme={theme} /> : null}
        </StepCard>
      ) : null}

      {step === 'bodyFat' ? (
        <StepCard title={t('bodySetup.bodyFat.title')} hint={t('bodySetup.bodyFat.hint')} theme={theme}>
          <UnitField
            value={bodyFatText}
            onChange={setBodyFatText}
            unit="%"
            placeholder={t('bodySetup.bodyFat.placeholder')}
            onSubmit={next}
          />
          {bodyFatText.trim() !== '' && !stepOk ? <Invalid text={t('bodySetup.bodyFat.invalid')} theme={theme} /> : null}
          <Pressable
            onPress={() => {
              setBodyFatText('');
              setIndex((i) => i + 1);
            }}
            hitSlop={8}
          >
            <Text style={[styles.skip, { color: theme.subtle }, theme.font.body]}>{t('bodySetup.bodyFat.skip')}</Text>
          </Pressable>
        </StepCard>
      ) : null}

      {step === 'goal' ? (
        <StepCard title={t('bodySetup.goal.title')} theme={theme}>
          {GOAL_MODES.map((m) => (
            <OptionRow
              key={m}
              title={t(`bodySetup.goal.${m}`)}
              desc={t(`bodySetup.goal.${m}Desc`)}
              active={goal === m}
              onPress={() => setGoal(m)}
              theme={theme}
            />
          ))}
        </StepCard>
      ) : null}

      {step === 'goalWeight' ? (
        <StepCard title={t('bodySetup.goalWeight.title')} hint={t('bodySetup.goalWeight.hint')} theme={theme}>
          <UnitField
            value={goalWeightText}
            onChange={setGoalWeightText}
            unit={t('weight.unit')}
            placeholder={t('bodySetup.goalWeight.placeholder')}
            onSubmit={next}
          />
          {goalWeightText.trim() !== '' && !stepOk ? (
            <Invalid
              text={t(goal === 'gain' ? 'bodySetup.goalWeight.directionGain' : 'bodySetup.goalWeight.directionLose')}
              theme={theme}
            />
          ) : null}
        </StepCard>
      ) : null}

      {step === 'tempo' ? (
        <StepCard title={t(goal === 'gain' ? 'bodySetup.tempo.titleGain' : 'bodySetup.tempo.titleLose')} theme={theme}>
          {DEFICIT_TEMPOS.map((tp) => (
            <OptionRow
              key={tp}
              title={t(`bodySetup.tempo.${tempoSet}.${tp}`)}
              desc={t(`bodySetup.tempo.${tempoSet}.${tp}Desc`)}
              active={tempo === tp}
              onPress={() => setTempo(tp)}
              theme={theme}
            />
          ))}
        </StepCard>
      ) : null}

      {step === 'result' && plan != null ? (
        <>
          <Card style={styles.card}>
            <Text style={[styles.heroLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
              {t('bodySetup.result.title').toUpperCase()}
            </Text>
            <View style={styles.heroRow}>
              <Text style={[styles.heroKcal, { color: theme.heroAccent }, theme.font.heading]}>≈{plan.kcal}</Text>
              <Text style={[styles.heroUnit, { color: theme.subtle }, theme.font.body]}>
                {t('bodySetup.result.perDay')}
              </Text>
            </View>
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
            <Text style={[styles.appliedLine, { color: theme.accent }, theme.font.bodyMedium]}>
              {/* The save above is skipped without a database — claiming
                  «записали как цель» then would be a false confirmation. */}
              {db != null ? t('bodySetup.result.applied') : t('bodySetup.result.notSaved')}
            </Text>
          </Card>

          <Card style={styles.card}>
            <Pressable
              onPress={() => setHowOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: howOpen }}
              style={styles.accHead}
            >
              <Text style={[styles.accTitle, { color: theme.text }, theme.font.bodySemiBold]}>
                {t('bodySetup.result.howTitle')}
              </Text>
              <Text style={[styles.chevron, { color: theme.subtle }]}>{howOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {howOpen ? (
              <>
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                  {t('bodySetup.result.bmr', {
                    kcal: plan.bmrKcal,
                    method: t(`bodySetup.result.method.${plan.bmrMethod}`),
                  })}
                </Text>
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                  {t('bodySetup.result.maintenance', { kcal: plan.maintenanceKcal })}
                </Text>
                {plan.mode !== 'maintain' && plan.maintenanceKcal > 0 ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t(`bodySetup.result.delta.${plan.mode}`, {
                      kcal: plan.kcal,
                      pct: Math.abs(Math.round((plan.kcal / plan.maintenanceKcal - 1) * 100)),
                    })}
                  </Text>
                ) : (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t('bodySetup.result.delta.maintain')}
                  </Text>
                )}
                {eta != null ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t(eta.key, { goal: goalWeightNum, n: eta.n })}
                  </Text>
                ) : null}
                {plan.floored ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t('weight.plan.floored', { kcal: plan.minDayKcal })}
                  </Text>
                ) : null}
                <Text style={[styles.boostSubTitle, { color: theme.text }, theme.font.bodySemiBold]}>
                  {t('bodySetup.result.boostTitle')}
                </Text>
                <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                  {t('bodySetup.result.boost')}
                </Text>
                {plan.mode === 'gain' ? (
                  <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
                    {t('bodySetup.result.gainNote')}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text style={[styles.teaser, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
                {t('bodySetup.result.howTeaser')}
              </Text>
            )}
          </Card>

          <Pressable
            onPress={() => router.push('/more/how-it-works')}
            hitSlop={6}
            style={styles.howLink}
            accessibilityRole="button"
          >
            <Text style={[styles.howLinkText, { color: theme.primary }, theme.font.body]}>
              {t('howItWorks.linkTitle')}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={theme.primary} />
          </Pressable>
          <Text style={[styles.editHint, { color: theme.subtle }, theme.font.body]}>{t('bodySetup.result.edit')}</Text>
          <PrimaryButton label={t('bodySetup.result.done')} onPress={() => router.back()} style={styles.cta} />
        </>
      ) : null}

      {step !== 'result' ? (
        <PrimaryButton
          label={lastInput ? t('bodySetup.calc') : t('bodySetup.next')}
          onPress={next}
          disabled={!stepOk || saving}
          style={styles.cta}
        />
      ) : null}
    </Screen>
  );
}

/// One wizard question: a card with the big question, an optional grey hint and
/// the answer control(s) below.
function StepCard({
  title,
  hint,
  children,
  theme,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  theme: Theme;
}) {
  return (
    <Card style={styles.card}>
      <Text style={[styles.stepTitle, { color: theme.text }, theme.font.bodySemiBold]}>{title}</Text>
      {hint ? <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{hint}</Text> : null}
      <View style={styles.control}>{children}</View>
    </Card>
  );
}

function UnitField({
  value,
  onChange,
  unit,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  unit: string;
  placeholder: string;
  onSubmit: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.unitRow}>
      <TextField
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholder={placeholder}
        autoFocus
        onSubmitEditing={onSubmit}
        style={styles.unitInput}
      />
      <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{unit}</Text>
    </View>
  );
}

function Invalid({ text, theme }: { text: string; theme: Theme }) {
  return <Text style={[styles.invalid, { color: theme.accent }, theme.font.bodyMedium]}>{text}</Text>;
}

/// A tappable answer option: title + one-line explanation + check when chosen.
function OptionRow({
  title,
  desc,
  active,
  onPress,
  theme,
}: {
  title: string;
  desc: string;
  active: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: active ? theme.primary : theme.separator,
          backgroundColor: active ? theme.primarySoft : theme.card,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={styles.optionBody}>
        <Text style={[styles.optionTitle, { color: theme.text }, theme.font.bodySemiBold]}>{title}</Text>
        <Text style={[styles.optionDesc, { color: theme.subtle }, theme.font.body]}>{desc}</Text>
      </View>
      {active ? <Ionicons name="checkmark-circle" size={22} color={theme.primary} /> : null}
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
  theme,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.primary : theme.card,
          borderColor: active ? theme.primary : theme.separator,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>{label}</Text>
    </Pressable>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const styles = StyleSheet.create({
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  backLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 14 },
  progress: { fontSize: 13 },
  card: { marginBottom: 14 },
  stepTitle: { fontSize: 19 },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  control: { marginTop: 14 },
  unitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  unitInput: { flex: 1 },
  unit: { fontSize: 15 },
  invalid: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  skip: { fontSize: 14, marginTop: 14, textAlign: 'center', paddingVertical: 4 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  chipText: { fontSize: 15 },
  option: {
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  optionBody: { flex: 1 },
  optionTitle: { fontSize: 15 },
  optionDesc: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  heroLabel: { fontSize: 12, letterSpacing: 1.44, marginBottom: 6 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heroKcal: { fontSize: 40, lineHeight: 44 },
  heroUnit: { fontSize: 14 },
  macroRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  macroTile: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  macroLabel: { fontSize: 11 },
  macroValue: { fontSize: 15, marginTop: 2 },
  appliedLine: { fontSize: 13, marginTop: 12 },
  accHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  accTitle: { fontSize: 15, flex: 1, paddingRight: 12 },
  chevron: { fontSize: 15 },
  teaser: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  boostSubTitle: { fontSize: 14, marginTop: 14 },
  note: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  editHint: { fontSize: 12, lineHeight: 17, marginBottom: 12, textAlign: 'center' },
  howLink: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', marginBottom: 10 },
  howLinkText: { fontSize: 13 },
  cta: { marginTop: 4, marginBottom: 24 },
});
