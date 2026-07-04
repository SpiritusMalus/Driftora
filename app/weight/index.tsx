import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { WeightRow } from '@/lib/core/db/schema';
import { ensureSettings, updateSettings, type SettingsPatch } from '@/lib/core/db/settings';
import { listWeights, upsertWeight } from '@/lib/core/db/weight';
import {
  ACTIVITY_LEVELS,
  GOAL_MODES,
  bmiCategory,
  bmiValue,
  suggestPlan,
  type ActivityLevel,
  type GoalMode,
  type Sex,
} from '@/lib/core/insights/bodyMetrics';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The weekly ritual this screen is built around: open → type one number →
/// immediately SEE what it means. Logging stays low-pressure (optional, echoed
/// where typed), the nutrition plan recomputes from the newest weight, and
/// everything secondary — BMI, body parameters, history, manual targets — is
/// folded into one-line sections so the ritual never scrolls through a form.
///
/// UX rule for this screen (user feedback 2026-07-03: «не понятно что
/// нажимать»): NOTHING here needs a separate save. Profile facts and targets
/// persist the moment they're edited (chips immediately, text fields when
/// editing ends), every save answers with a visible «✓», and the logged weight
/// is echoed right where it was typed instead of silently moving to a list.
export default function WeightScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<WeightRow[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  // «120.0 кг — записано ✓» under the save button; cleared when typing again.
  const [weightAck, setWeightAck] = useState<string | null>(null);

  // Body profile + КБЖУ targets (single app_settings row, auto-persisted).
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [heightText, setHeightText] = useState('');
  const [sex, setSex] = useState<'' | Sex>('');
  const [birthYearText, setBirthYearText] = useState('');
  const [activity, setActivity] = useState<'' | ActivityLevel>('');
  const [goalMode, setGoalMode] = useState<GoalMode>('maintain');
  const [kcal, setKcal] = useState('2000');
  const [protein, setProtein] = useState('120');
  const [fat, setFat] = useState('70');
  const [carb, setCarb] = useState('200');
  // Transient «Сохранено ✓» after any auto-save, shown WHERE the edit happened.
  const [ack, setAck] = useState<{ where: 'plan' | 'body' | 'manual'; text: string } | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collapsed-by-default sections; body opens itself while the profile is
  // still incomplete (it's the one thing the plan needs from the user).
  const [openBmi, setOpenBmi] = useState(false);
  const [openBody, setOpenBody] = useState(false);
  const [openHistory, setOpenHistory] = useState(false);
  const [openManual, setOpenManual] = useState(false);

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
        const list = await listWeights(db, 30);
        if (active) setItems(list);
        if (!profileLoaded) {
          const s = await ensureSettings(db);
          if (!active) return;
          setHeightText(s.heightCm > 0 ? String(s.heightCm) : '');
          setSex(s.sex);
          setBirthYearText(s.birthYear > 0 ? String(s.birthYear) : '');
          setActivity(s.activityLevel);
          setGoalMode(s.goalMode);
          setKcal(String(s.targetKcal));
          setProtein(String(s.targetProteinG));
          setFat(String(s.targetFatG));
          setCarb(String(s.targetCarbG));
          const complete =
            (s.sex === 'male' || s.sex === 'female') &&
            s.activityLevel !== '' &&
            s.heightCm >= 100 &&
            s.heightCm <= 250 &&
            s.birthYear > 0;
          if (!complete) setOpenBody(true);
          setProfileLoaded(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [db, profileLoaded]),
  );

  /// Persist a settings patch immediately and flash the «✓» tick at `where`.
  /// This screen has no save buttons — edits ARE the save.
  async function persist(patch: SettingsPatch, ackText: string, where: 'plan' | 'body' | 'manual') {
    if (!db) return;
    await updateSettings(db, patch);
    setAck({ where, text: ackText });
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => setAck(null), 2500);
  }

  async function onSaveWeight() {
    const kg = toNumber(text);
    if (!db || kg <= 0) return;
    setSaving(true);
    try {
      // Delta vs the previous DIFFERENT day (a same-day re-weigh overwrites, so
      // comparing against it would always read «0.0 с прошлого раза»).
      const today = toDayString(new Date());
      const prev = (items ?? []).find((w) => w.date !== today) ?? null;
      await upsertWeight(db, new Date(), kg);
      setText('');
      const delta = prev ? kg - prev.weightKg : 0;
      setWeightAck(
        prev && Math.abs(delta) >= 0.05
          ? t('weight.savedDelta', { kg: kg.toFixed(1), delta: signedKg(delta) })
          : t('weight.savedNow', { kg: kg.toFixed(1) }),
      );
      setItems(await listWeights(db, 30));
    } finally {
      setSaving(false);
    }
  }

  const points: WeightPoint[] = (items ?? []).map((w) => ({ date: w.date, weightKg: w.weightKg }));
  const trend = summarizeWeightTrend(points);
  const trendLine = (() => {
    if (!trend) return null;
    const abs = Math.abs(trend.deltaKg).toFixed(1);
    const days = trend.spanDays;
    if (trend.direction === 'steady') return t('weight.trend.steady', { days, abs });
    if (trend.direction === 'down') return t('weight.trend.down', { days, abs });
    return t('weight.trend.up', { days, abs });
  })();

  const valid = toNumber(text) > 0;

  const latestKg = items != null && items.length > 0 ? items[0].weightKg : 0;
  const heightCm = toNumber(heightText);
  const bmi = bmiValue(latestKg, heightCm);

  const profile = { sex, birthYear: Math.round(toNumber(birthYearText)), heightCm, activityLevel: activity };
  // Probe with a plausible dummy weight: tells "profile incomplete" apart from
  // "no weight logged yet", so the plan card can say exactly what's missing.
  const profileComplete = suggestPlan(profile, 70, 'maintain') != null;
  const plan = suggestPlan(profile, latestKg, goalMode);
  const planApplied =
    plan != null &&
    toNumber(kcal) === plan.kcal &&
    toNumber(protein) === plan.prot &&
    toNumber(fat) === plan.fat &&
    toNumber(carb) === plan.carb;

  const rows: RowSpec[] = (items ?? []).map((w) => ({
    key: w.date,
    title: formatDay(w.date),
    right: (
      <Text style={[styles.rowKg, { color: theme.text }, theme.font.bodySemiBold]}>
        {w.weightKg.toFixed(1)} {t('weight.unit')}
      </Text>
    ),
  }));

  const bodySummary = profileComplete
    ? [
        `${Math.round(heightCm)} ${t('weight.heightUnit')}`,
        sex ? t(`weight.formula.${sex}`) : '',
        birthYearText,
        activity ? t(`weight.formula.activityLevel.${activity}`) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : t('weight.sections.body.empty');

  const bmiSummary =
    bmi != null
      ? t('weight.bmi.summary', { value: bmi.toFixed(1), category: t(`weight.bmi.category.${bmiCategory(bmi)}`) })
      : latestKg <= 0
        ? t('weight.bmi.needWeightShort')
        : t('weight.bmi.needHeightShort');

  const manualSummary = t('weight.sections.manual.summary', {
    kcal: Math.round(toNumber(kcal)),
    prot: Math.round(toNumber(protein)),
    fat: Math.round(toNumber(fat)),
    carb: Math.round(toNumber(carb)),
  });

  return (
    <Screen>
      {/* ── 1. The ritual: type today's weight, see it acknowledged ── */}
      <View style={styles.inputRow}>
        <TextField
          value={text}
          onChangeText={(v) => {
            setText(v);
            if (weightAck) setWeightAck(null);
          }}
          placeholder={t('weight.placeholder')}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.unit')}</Text>
      </View>
      <PrimaryButton
        label={saving ? t('weight.saving') : t('weight.save')}
        onPress={onSaveWeight}
        disabled={db == null || !valid || saving}
        style={styles.save}
      />
      {/* The number the user just typed must not silently vanish into the
          history list — echo it (with its delta) right here. */}
      {weightAck ? (
        <Text style={[styles.weightAck, { color: theme.accent }, theme.font.bodyMedium]}>{weightAck}</Text>
      ) : items != null && items.length > 0 ? (
        <Text style={[styles.weightAck, { color: theme.subtle }, theme.font.body]}>
          {t('weight.lastEntry', { kg: items[0].weightKg.toFixed(1), date: formatDay(items[0].date) })}
        </Text>
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.dbUnavailable')}</Text>
      ) : null}

      {/* ── 2. Trend: one line, because single weigh-ins are noise ── */}
      {trendLine ? (
        <Card style={styles.trendCard}>
          <Text style={[styles.trendText, { color: theme.text }, theme.font.bodySemiBold]}>{trendLine}</Text>
          <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.note')}</Text>
        </Card>
      ) : null}

      {/* ── 3. The centerpiece: a human-language КБЖУ plan that follows the
             latest weight. One tap makes it the food-diary goal. ── */}
      {db != null ? (
        <Card style={styles.trendCard}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('weight.plan.title')}
            </Text>
            {ack?.where === 'plan' ? (
              <Text style={[styles.ackTick, { color: theme.accent }, theme.font.bodyMedium]}>{ack.text}</Text>
            ) : null}
          </View>
          <View style={styles.chips}>
            {GOAL_MODES.map((m) => (
              <Chip
                key={m}
                label={t(`weight.plan.mode.${m}`)}
                active={goalMode === m}
                onPress={() => {
                  setGoalMode(m);
                  void persist({ goalMode: m }, t('weight.targets.savedTick'), 'plan');
                }}
                theme={theme}
              />
            ))}
          </View>

          {plan != null ? (
            <>
              <Text style={[styles.planIntro, { color: theme.text }, theme.font.body]}>
                {t(`weight.plan.intro.${plan.mode}`, {
                  kg: latestKg.toFixed(1),
                  pace: plan.paceKgPerWeek.toFixed(1),
                })}
              </Text>
              <Text style={[styles.planKcal, { color: theme.text }, theme.font.bodySemiBold]}>
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
              {plan.floored ? (
                <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
                  {t('weight.plan.floored')}
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
              <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
                {t('weight.plan.recalc')} {t('weight.targets.note')}
              </Text>
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('weight.plan.note')}</Text>
            </>
          ) : (
            <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
              {profileComplete ? t('weight.plan.needWeight') : t('weight.plan.needProfile')}
            </Text>
          )}
        </Card>
      ) : null}

      {/* ── 4. Everything secondary, one quiet line each ── */}
      {db != null ? (
        <>
          <Section
            title={t('weight.bmi.title')}
            summary={bmiSummary}
            open={openBmi}
            onToggle={() => setOpenBmi((v) => !v)}
            theme={theme}
          >
            {bmi != null ? (
              <>
                <Text style={[styles.bmiValue, { color: theme.text }, theme.font.bodySemiBold]}>
                  {t('weight.bmi.value', {
                    value: bmi.toFixed(1),
                    category: t(`weight.bmi.category.${bmiCategory(bmi)}`),
                  })}
                </Text>
                <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
                  {t('weight.bmi.current', { kg: latestKg.toFixed(1), cm: Math.round(heightCm) })}
                </Text>
                <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
                  {t('weight.bmi.ranges')}
                </Text>
              </>
            ) : (
              <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
                {latestKg <= 0 ? t('weight.bmi.needWeight') : t('weight.bmi.needHeight')}
              </Text>
            )}
            <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>
              {t('weight.bmi.disclaimer')}
            </Text>
          </Section>

          <Section
            title={t('weight.sections.body.title')}
            summary={bodySummary}
            open={openBody}
            onToggle={() => setOpenBody((v) => !v)}
            ack={ack?.where === 'body' ? ack.text : null}
            theme={theme}
          >
            <View style={styles.heightRow}>
              <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{t('weight.height')}</Text>
              <TextField
                value={heightText}
                onChangeText={setHeightText}
                onEndEditing={() => void persist({ heightCm: toNumber(heightText) }, t('weight.targets.savedTick'), 'body')}
                keyboardType="numeric"
                style={styles.heightInput}
              />
              <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.heightUnit')}</Text>
            </View>
            <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{t('weight.formula.sex')}</Text>
            <View style={styles.chips}>
              {(['male', 'female'] as const).map((s) => (
                <Chip
                  key={s}
                  label={t(`weight.formula.${s}`)}
                  active={sex === s}
                  onPress={() => {
                    setSex(s);
                    void persist({ sex: s }, t('weight.targets.savedTick'), 'body');
                  }}
                  theme={theme}
                />
              ))}
            </View>
            <Field
              label={t('weight.formula.birthYear')}
              value={birthYearText}
              onChange={setBirthYearText}
              onDone={() =>
                void persist({ birthYear: Math.round(toNumber(birthYearText)) }, t('weight.targets.savedTick'), 'body')
              }
              theme={theme}
            />
            <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>
              {t('weight.formula.activity')}
            </Text>
            <View style={styles.chips}>
              {ACTIVITY_LEVELS.map((a) => (
                <Chip
                  key={a}
                  label={t(`weight.formula.activityLevel.${a}`)}
                  active={activity === a}
                  onPress={() => {
                    setActivity(a);
                    void persist({ activityLevel: a }, t('weight.targets.savedTick'), 'body');
                  }}
                  theme={theme}
                />
              ))}
            </View>
            <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>
              {t('weight.formula.activityNote')}
            </Text>
          </Section>

          <Section
            title={t('weight.sections.history.title')}
            summary={t('weight.sections.history.count', { count: items?.length ?? 0 })}
            open={openHistory}
            onToggle={() => setOpenHistory((v) => !v)}
            theme={theme}
          >
            {items == null || items.length === 0 ? (
              <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.empty')}</Text>
            ) : (
              <ListGroup rows={rows} />
            )}
          </Section>

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
            <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.targets.note')}</Text>
          </Section>
        </>
      ) : null}
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

/// '+0.4' / '-0.4' — the sign IS the message, so it is always printed.
function signedKg(delta: number): string {
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
}

/// Local calendar day as 'YYYY-MM-DD' (matches the weights table's day key).
function toDayString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/// '2026-06-17' → '17.06.2026'.
function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 12 },
  input: { flex: 1 },
  unit: { fontSize: 15 },
  save: { marginBottom: 6 },
  weightAck: { fontSize: 14, textAlign: 'center', marginBottom: 10 },
  trendCard: { marginBottom: 16 },
  trendText: { fontSize: 15 },
  trendNote: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16 },
  ackTick: { fontSize: 13 },
  planIntro: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  planKcal: { fontSize: 22, marginTop: 8, marginBottom: 10 },
  macroRow: { flexDirection: 'row', gap: 8 },
  macroTile: { flex: 1, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center' },
  macroLabel: { fontSize: 11 },
  macroValue: { fontSize: 15, marginTop: 2 },
  appliedLine: { fontSize: 14, marginTop: 12 },
  heightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: 2 },
  heightInput: { flex: 1 },
  bmiValue: { fontSize: 15, marginTop: 2 },
  disclaimer: { fontSize: 11, fontStyle: 'italic', marginTop: 8, lineHeight: 16 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, marginBottom: 5, marginTop: 4 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13 },
  applyBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start', marginTop: 12 },
  applyText: { fontSize: 14 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  rowKg: { fontSize: 16 },
  sectionCard: { marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionTitle: { fontSize: 15 },
  sectionSummary: { fontSize: 13, flex: 1, textAlign: 'right' },
  sectionBody: { marginTop: 12 },
});
