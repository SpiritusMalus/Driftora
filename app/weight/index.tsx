import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  bmiCategory,
  bmiValue,
  suggestTargets,
  type ActivityLevel,
  type Sex,
} from '@/lib/core/insights/bodyMetrics';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Log today's weight (one row per day) and reread the trend. Deliberately
/// low-pressure: optional, no daily nag, and the trend is stated neutrally.
/// Also hosts the body-numbers context that belongs WITH the weight: BMI (with
/// an honest "population statistic" disclaimer) and the КБЖУ targets + their
/// Mifflin–St Jeor maintenance estimate.
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
  const [kcal, setKcal] = useState('2000');
  const [protein, setProtein] = useState('120');
  const [fat, setFat] = useState('70');
  const [carb, setCarb] = useState('200');
  // Transient «Сохранено ✓» in the targets card after any auto-save.
  const [targetsAck, setTargetsAck] = useState<string | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setKcal(String(s.targetKcal));
          setProtein(String(s.targetProteinG));
          setFat(String(s.targetFatG));
          setCarb(String(s.targetCarbG));
          setProfileLoaded(true);
        }
      })();
      return () => {
        active = false;
      };
    }, [db, profileLoaded]),
  );

  /// Persist a settings patch immediately and flash the «Сохранено ✓» tick.
  /// This screen has no save buttons — edits ARE the save.
  async function persist(patch: SettingsPatch, ack: string) {
    if (!db) return;
    await updateSettings(db, patch);
    setTargetsAck(ack);
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => setTargetsAck(null), 2500);
  }

  async function onSaveWeight() {
    const kg = toNumber(text);
    if (!db || kg <= 0) return;
    setSaving(true);
    try {
      await upsertWeight(db, new Date(), kg);
      setText('');
      setWeightAck(t('weight.savedNow', { kg: kg.toFixed(1) }));
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

  // BMI from the CURRENT height input (live) + the latest logged weight.
  const latestKg = items != null && items.length > 0 ? items[0].weightKg : 0;
  const heightCm = toNumber(heightText);
  const bmi = bmiValue(latestKg, heightCm);
  const bmiLine =
    bmi != null ? t('weight.bmi.value', { value: bmi.toFixed(1), category: t(`weight.bmi.category.${bmiCategory(bmi)}`) }) : null;

  // Maintenance estimate goes live as soon as the profile is complete.
  const suggested = suggestTargets(
    { sex, birthYear: Math.round(toNumber(birthYearText)), heightCm, activityLevel: activity },
    latestKg,
  );

  const rows: RowSpec[] = (items ?? []).map((w) => ({
    key: w.date,
    title: formatDay(w.date),
    right: (
      <Text style={[styles.rowKg, { color: theme.text }, theme.font.bodySemiBold]}>
        {w.weightKg.toFixed(1)} {t('weight.unit')}
      </Text>
    ),
  }));

  return (
    <Screen>
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
          history list — echo it right here. */}
      {weightAck ? (
        <Text style={[styles.weightAck, { color: theme.accent }, theme.font.bodyMedium]}>{weightAck}</Text>
      ) : null}

      {trendLine ? (
        <Card style={styles.trendCard}>
          <Text style={[styles.trendText, { color: theme.text }, theme.font.bodySemiBold]}>{trendLine}</Text>
          <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.note')}</Text>
        </Card>
      ) : null}

      {/* BMI — the WHO bands, framed honestly: a 19th-century POPULATION
          statistic that cannot see muscle mass, shown as reference, not verdict. */}
      {db != null ? (
        <Card style={styles.trendCard}>
          <Text style={[styles.cardTitle, { color: theme.text }, theme.font.bodySemiBold]}>{t('weight.bmi.title')}</Text>
          <View style={styles.heightRow}>
            <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{t('weight.height')}</Text>
            <TextField
              value={heightText}
              onChangeText={setHeightText}
              onEndEditing={() => void persist({ heightCm: toNumber(heightText) }, t('weight.targets.savedTick'))}
              keyboardType="numeric"
              style={styles.heightInput}
            />
            <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.heightUnit')}</Text>
          </View>
          {bmiLine != null ? (
            <>
              <Text style={[styles.bmiValue, { color: theme.text }, theme.font.bodySemiBold]}>{bmiLine}</Text>
              {/* Show WHICH numbers produced it — this is where the logged
                  weight and the height visibly meet. */}
              <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
                {t('weight.bmi.current', { kg: latestKg.toFixed(1), cm: Math.round(heightCm) })}
              </Text>
              <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.bmi.ranges')}</Text>
            </>
          ) : (
            <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>
              {heightCm > 0 ? t('weight.bmi.needWeight') : t('weight.bmi.needHeight')}
            </Text>
          )}
          <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('weight.bmi.disclaimer')}</Text>
        </Card>
      ) : null}

      {/* History right after BMI — the saved weight lands somewhere VISIBLE,
          not below the fold of the targets card. */}
      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.empty')}</Text>
      ) : (
        <View style={styles.history}>
          <ListGroup rows={rows} />
        </View>
      )}

      {/* КБЖУ targets — everything auto-saves; the formula writes straight
          into the targets with one tap. */}
      {db != null ? (
        <Card style={styles.targetsCard}>
          <View style={styles.titleRow}>
            <Text style={[styles.cardTitle, { color: theme.text }, theme.font.bodySemiBold]}>{t('weight.targets.title')}</Text>
            {targetsAck ? (
              <Text style={[styles.ackTick, { color: theme.accent }, theme.font.bodyMedium]}>{targetsAck}</Text>
            ) : null}
          </View>
          <Field
            label={t('settings.targetKcal')}
            value={kcal}
            onChange={setKcal}
            onDone={() => void persist({ targetKcal: toNumber(kcal) }, t('weight.targets.savedTick'))}
            theme={theme}
          />
          <Field
            label={t('settings.targetProtein')}
            value={protein}
            onChange={setProtein}
            onDone={() => void persist({ targetProteinG: toNumber(protein) }, t('weight.targets.savedTick'))}
            theme={theme}
          />
          <Field
            label={t('settings.targetFat')}
            value={fat}
            onChange={setFat}
            onDone={() => void persist({ targetFatG: toNumber(fat) }, t('weight.targets.savedTick'))}
            theme={theme}
          />
          <Field
            label={t('settings.targetCarb')}
            value={carb}
            onChange={setCarb}
            onDone={() => void persist({ targetCarbG: toNumber(carb) }, t('weight.targets.savedTick'))}
            theme={theme}
          />
          <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.targets.note')}</Text>

          <Text style={[styles.formulaTitle, { color: theme.text }, theme.font.bodySemiBold]}>{t('weight.formula.title')}</Text>
          <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{t('weight.formula.sex')}</Text>
          <View style={styles.chips}>
            {(['male', 'female'] as const).map((s) => (
              <Chip
                key={s}
                label={t(`weight.formula.${s}`)}
                active={sex === s}
                onPress={() => {
                  setSex(s);
                  void persist({ sex: s }, t('weight.targets.savedTick'));
                }}
                theme={theme}
              />
            ))}
          </View>
          <Field
            label={t('weight.formula.birthYear')}
            value={birthYearText}
            onChange={setBirthYearText}
            onDone={() => void persist({ birthYear: Math.round(toNumber(birthYearText)) }, t('weight.targets.savedTick'))}
            theme={theme}
          />
          <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{t('weight.formula.activity')}</Text>
          <View style={styles.chips}>
            {ACTIVITY_LEVELS.map((a) => (
              <Chip
                key={a}
                label={t(`weight.formula.activityLevel.${a}`)}
                active={activity === a}
                onPress={() => {
                  setActivity(a);
                  void persist({ activityLevel: a }, t('weight.targets.savedTick'));
                }}
                theme={theme}
              />
            ))}
          </View>
          <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('weight.formula.activityNote')}</Text>

          {suggested != null ? (
            <>
              <Text style={[styles.bmiValue, { color: theme.text }, theme.font.bodySemiBold]}>
                {t('weight.formula.result', { ...suggested })}
              </Text>
              <Pressable
                onPress={() => {
                  setKcal(String(suggested.kcal));
                  setProtein(String(suggested.prot));
                  setFat(String(suggested.fat));
                  setCarb(String(suggested.carb));
                  // One tap = the numbers land in the fields AND are saved.
                  void persist(
                    {
                      targetKcal: suggested.kcal,
                      targetProteinG: suggested.prot,
                      targetFatG: suggested.fat,
                      targetCarbG: suggested.carb,
                    },
                    t('weight.formula.applied'),
                  );
                }}
                style={({ pressed }) => [styles.applyBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.applyText, { color: theme.primary }, theme.font.bodySemiBold]}>
                  {t('weight.formula.apply')}
                </Text>
              </Pressable>
            </>
          ) : (
            <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.formula.incomplete')}</Text>
          )}
          <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('weight.formula.note')}</Text>
        </Card>
      ) : null}
    </Screen>
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
  targetsCard: { marginBottom: 24 },
  trendText: { fontSize: 15 },
  trendNote: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 16 },
  ackTick: { fontSize: 13 },
  heightRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, marginTop: 6 },
  heightInput: { flex: 1 },
  bmiValue: { fontSize: 15, marginTop: 8 },
  disclaimer: { fontSize: 11, fontStyle: 'italic', marginTop: 8, lineHeight: 16 },
  field: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, marginBottom: 5, marginTop: 4 },
  formulaTitle: { fontSize: 15, marginTop: 14, marginBottom: 6 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13 },
  applyBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start', marginTop: 10 },
  applyText: { fontSize: 14 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 8, marginBottom: 16 },
  history: { marginTop: 4, marginBottom: 16 },
  rowKg: { fontSize: 16 },
});
