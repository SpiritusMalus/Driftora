import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { DAY_NAV_BACK_DAYS, DayNav } from '@/components/ui/DayNav';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { WorkoutRow } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { latestWeight } from '@/lib/core/db/weight';
import {
  deleteWorkout,
  editedWorkoutKcal,
  getWorkout,
  updateWorkout,
  type WorkoutEdit,
} from '@/lib/core/db/workouts';
import {
  POPULATION_RESTING_KCAL_PER_KG_H,
  restingRateForProfile,
  setsToMinutes,
  STRENGTH_INTENSITIES,
  supportsIntensity,
  supportsSets,
  supportsSpeed,
  WORKOUT_TYPES,
  type StrengthIntensity,
  type WorkoutType,
} from '@/lib/core/insights/bodyMetrics';
import { daysAgo } from '@/lib/i18n/formatDay';
import { budgetKcal } from '@/lib/i18n/formatWorkout';
import { useTheme } from '@/lib/theme/theme';

/// Change a logged workout — the half of the log that was missing: a session
/// could be added and deleted, never corrected, so «сорок минут, а не тридцать»
/// meant deleting the row and typing the whole thing again (device feedback
/// 2026-08-23: «изменить упражнение»). Everything the add form could set is
/// editable here, plus the DAY: «записал не в тот день» is the other half of the
/// same complaint, and moving the row beats re-entering it.
///
/// kcal follows the rules the log already lives by, in [editedWorkoutKcal]: a
/// measured number («по трекеру» / «с часов») is the user's own reading and
/// stays verbatim, a known type is recomputed from the current weight, and an
/// AI-parsed «другое» — whose MET was never stored — scales with its duration.
/// The «≈ N ккал» line below the fields runs the SAME function that the save
/// does, so the preview can never disagree with what lands in the db.
export default function WorkoutEntryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = Number(id);

  const [row, setRow] = useState<WorkoutRow | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  // The update threw — without a visible line the tap looks ignored and the
  // user leaves sure the change landed (the food edit screen's rule).
  const [saveIssue, setSaveIssue] = useState(false);

  // The edit under the fingers.
  const [type, setType] = useState<string>('walk');
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState('');
  const [sets, setSets] = useState('');
  const [speed, setSpeed] = useState('');
  // Nullable on purpose: an AI-parsed strength row without a level was priced
  // at the fixed MET, and preselecting «средняя» here would silently raise its
  // kcal. No level → no chip lit; tapping a lit chip clears it again.
  const [intensity, setIntensity] = useState<StrengthIntensity | null>(null);
  const [kcalText, setKcalText] = useState('');
  const [day, setDay] = useState('');

  // The kcal math's inputs — same sources as the log card, so a recomputed
  // number here matches what adding the workout today would have produced.
  const [weightKg, setWeightKg] = useState(70);
  const [restingRate, setRestingRate] = useState(POPULATION_RESTING_KCAL_PER_KG_H);
  const [hideCalories, setHideCalories] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) return;
      // A malformed link (`driftora://workout/abc`) lands on the same honest
      // «запись не найдена» as a deleted row, not on a forever-blank screen.
      if (!Number.isFinite(workoutId)) {
        setMissing(true);
        return;
      }
      const [w, weight, settings] = await Promise.all([
        getWorkout(db, workoutId),
        latestWeight(db),
        ensureSettings(db),
      ]);
      if (!active) return;
      if (!w) {
        setMissing(true);
        return;
      }
      const kg = weight != null && weight.weightKg > 0 ? weight.weightKg : 70;
      setWeightKg(kg);
      setRestingRate(
        restingRateForProfile(
          {
            sex: settings.sex,
            birthYear: settings.birthYear,
            heightCm: settings.heightCm,
            activityLevel: settings.activityLevel,
            bodyFatPct: settings.bodyFatPct,
            waistCm: settings.waistCm,
            bmrFactor: settings.bmrFactor,
          },
          kg,
        ),
      );
      setHideCalories(settings.hideCalories);
      setRow(w);
      setType(w.type);
      setLabel(w.label ?? '');
      setMinutes(w.minutes > 0 ? String(w.minutes) : '');
      setSets(w.sets != null && w.sets > 0 ? String(w.sets) : '');
      setSpeed(w.speedKmh != null && w.speedKmh > 0 ? String(w.speedKmh) : '');
      if (w.intensity === 'light' || w.intensity === 'moderate' || w.intensity === 'heavy') {
        setIntensity(w.intensity);
      }
      setKcalText(String(Math.round(Number(w.kcal))));
      setDay(w.date);
    })();
    return () => {
      active = false;
    };
  }, [db, workoutId]);

  const known = (WORKOUT_TYPES as readonly string[]).includes(type);
  // A watch session is re-imported on every sync, so an edit to one would be
  // silently overwritten — the row is shown as it is, and only «убрать» (which
  // tombstones the OS record) actually sticks.
  const fromDevice = row?.source === 'device';
  // «По трекеру»: the number was measured, not modelled — the kcal field
  // replaces the whole MET form.
  const measured = row?.source === 'tracker' || fromDevice;
  // Strength is logged «подходами» in the add form — but an AI parse can land a
  // strength row with minutes and no sets («жим 30 минут»). Edit each row in the
  // unit it was actually logged in instead of demanding a set count nobody
  // counted; a set-based row switched to a time type keeps the minutes those
  // sets already estimate (see [setsToMinutes]).
  const setBased = row != null && row.sets != null && row.sets > 0;
  const bySets = known && supportsSets(type as WorkoutType) && setBased;

  const num = (s: string) => Number(s.replace(',', '.'));
  const editedMinutes = bySets ? setsToMinutes(num(sets)) : num(minutes);
  const edit: WorkoutEdit = {
    type,
    label: label.trim() || null,
    minutes: Number.isFinite(editedMinutes) ? editedMinutes : 0,
    sets: bySets && num(sets) > 0 ? num(sets) : null,
    speedKmh: known && supportsSpeed(type as WorkoutType) && num(speed) > 0 ? num(speed) : null,
    intensity: known && supportsIntensity(type as WorkoutType) ? intensity : null,
    date: day || null,
    kcal: measured && num(kcalText) > 0 ? num(kcalText) : null,
  };
  const preview = row ? editedWorkoutKcal(row, edit, weightKg, restingRate) : 0;
  // Nothing to save without a duration (or a set count, or a measured number).
  const valid = measured ? num(kcalText) > 0 : edit.minutes > 0;

  async function onSave() {
    if (!db || !row) return;
    setBusy(true);
    setSaveIssue(false);
    try {
      await updateWorkout(db, workoutId, edit, weightKg, restingRate);
      router.back();
    } catch {
      setBusy(false);
      setSaveIssue(true);
    }
  }

  function onDelete() {
    Alert.alert(t('workouts.removeConfirmTitle'), t('workouts.removeConfirmBody'), [
      { text: t('workouts.removeCancel'), style: 'cancel' },
      {
        text: t('workouts.remove'),
        style: 'destructive',
        onPress: () => {
          if (!db) return;
          setBusy(true);
          void (async () => {
            try {
              await deleteWorkout(db, workoutId);
              router.back();
            } catch {
              setBusy(false);
              setSaveIssue(true);
            }
          })();
        },
      },
    ]);
  }

  if (missing) {
    return (
      <Screen>
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('workouts.editGone')}</Text>
      </Screen>
    );
  }
  if (!row) return <Screen>{null}</Screen>;

  return (
    <Screen>
      {fromDevice ? (
        <Card style={styles.noteCard}>
          <Text style={[styles.deviceNote, { color: theme.subtle }, theme.font.body]}>
            {t('workouts.editDeviceNote')}
          </Text>
        </Card>
      ) : null}

      <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('workouts.editLabel')}</Text>
      <TextField
        value={label}
        onChangeText={setLabel}
        editable={!fromDevice}
        placeholder={known ? t(`workouts.type.${type}`) : t('workouts.type.other')}
        style={styles.titleInput}
      />

      {!fromDevice ? (
        <>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('workouts.editType')}</Text>
          <ChipRow style={styles.chips}>
            {WORKOUT_TYPES.map((w) => (
              <Chip key={w} label={t(`workouts.type.${w}`)} selected={type === w} onPress={() => setType(w)} />
            ))}
            {/* «Другое» only exists on a row that already IS one (an AI-parsed
                activity with no MET of ours) — it stays reachable so the switch
                to a real type is undoable, but never invites a known workout
                into the bucket we cannot recompute. */}
            {!(WORKOUT_TYPES as readonly string[]).includes(row.type) ? (
              <Chip
                label={t('workouts.type.other')}
                selected={!known}
                onPress={() => setType(row.type)}
              />
            ) : null}
          </ChipRow>
        </>
      ) : null}

      {measured ? (
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('workouts.editKcal')}</Text>
          <View style={styles.row}>
            <TextField
              value={kcalText}
              onChangeText={setKcalText}
              editable={!fromDevice}
              keyboardType="numeric"
              placeholder={t('workouts.tracker.kcalPlaceholder')}
              style={styles.numInput}
            />
            <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('units.kcal')}</Text>
          </View>
          <Text style={[styles.fieldHint, { color: theme.subtle }, theme.font.body]}>
            {t('workouts.tracker.hint')}
          </Text>
        </View>
      ) : null}

      {!fromDevice ? (
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>
            {bySets ? t('workouts.editSets') : t('workouts.editMinutes')}
          </Text>
          <View style={styles.row}>
            <TextField
              value={bySets ? sets : minutes}
              onChangeText={bySets ? setSets : setMinutes}
              keyboardType="numeric"
              placeholder={bySets ? t('workouts.setsPlaceholder') : t('workouts.minutes')}
              style={styles.numInput}
            />
            <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>
              {bySets ? t('workouts.setsUnit') : t('workouts.min')}
            </Text>
          </View>
        </View>
      ) : null}

      {!fromDevice && known && supportsIntensity(type as WorkoutType) ? (
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>
            {t('workouts.intensity.label')}
          </Text>
          <ChipRow>
            {STRENGTH_INTENSITIES.map((lv) => (
              <Chip
                key={lv}
                label={t(`workouts.intensity.${lv}`)}
                selected={intensity === lv}
                onPress={() => setIntensity((prev) => (prev === lv ? null : lv))}
              />
            ))}
          </ChipRow>
        </View>
      ) : null}

      {!fromDevice && known && supportsSpeed(type as WorkoutType) ? (
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('workouts.editSpeed')}</Text>
          <View style={styles.row}>
            <TextField
              value={speed}
              onChangeText={setSpeed}
              keyboardType="numeric"
              placeholder={t('workouts.speedHint', { n: type === 'walk' ? 5 : type === 'run' ? 10 : 20 })}
              style={styles.numInput}
            />
            <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('workouts.kmh')}</Text>
          </View>
        </View>
      ) : null}

      {/* The day the session belongs to. A device row keeps the day its watch
          recorded — moving a measured session would make its own timestamps lie. */}
      {!fromDevice ? (
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{t('workouts.editDate')}</Text>
          {/* The floor widens for a row older than the default horizon, so its
              own day stays reachable — a stray «›» on an old entry must be
              undoable with «‹», not only by leaving without saving. */}
          <DayNav value={day} onChange={setDay} backDays={Math.max(DAY_NAV_BACK_DAYS, daysAgo(row.date))} />
        </View>
      ) : null}

      {/* What this edit will be worth to the day — the same currency the log
          rows speak: what it ADDS to the budget, not what it burns. */}
      {!hideCalories ? (
        <Text style={[styles.preview, { color: theme.subtle }, theme.font.body]}>
          {t('workouts.editResult', { kcal: budgetKcal(preview) })}
        </Text>
      ) : null}

      {!fromDevice ? (
        <PrimaryButton
          label={t('workouts.editSave')}
          onPress={() => void onSave()}
          disabled={busy || !valid}
          style={styles.save}
        />
      ) : null}
      {saveIssue ? (
        <Text style={[styles.saveIssue, { color: theme.primary }, theme.font.bodyMedium]}>
          {t('workouts.editSaveFailed')}
        </Text>
      ) : null}
      {/* Destructive + irreversible → the quietest control on the screen, like
          the food entry's delete. */}
      <Pressable
        onPress={onDelete}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('workouts.removeAction')}
        style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.separator, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.subtle }, theme.font.body]}>
          {t('workouts.removeAction')}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  noteCard: { marginBottom: 14 },
  deviceNote: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, marginBottom: 4 },
  titleInput: { marginBottom: 14 },
  chips: { marginBottom: 2 },
  field: { marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numInput: { width: 112 },
  unit: { fontSize: 13 },
  fieldHint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  preview: { fontSize: 13, lineHeight: 18, marginTop: 16 },
  save: { marginTop: 10 },
  saveIssue: { fontSize: 13, marginTop: 8, textAlign: 'center' },
  deleteBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  deleteText: { fontSize: 14 },
});
