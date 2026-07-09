import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { AI_CONSENT_VERSION, grantAiConsent, needsAiConsent } from '@/lib/core/consent/consent';
import type { WorkoutRow } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { latestWeight } from '@/lib/core/db/weight';
import { addParsedWorkout, addWorkout, deleteWorkout, listWorkoutsForDay } from '@/lib/core/db/workouts';
import {
  EATBACK_FRACTION,
  setsToMinutes,
  supportsSets,
  supportsSpeed,
  WORKOUT_TYPES,
  type WorkoutType,
} from '@/lib/core/insights/bodyMetrics';
import { getWorkoutParser, isWorkoutParserConfigured } from '@/lib/core/services/workoutParser';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Whether an online AI parser is configured for this build (env at bundle time).
const AI_CONFIGURED = isWorkoutParserConfigured();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/// «Тренировки сегодня» — log a workout (type + minutes → kcal via MET, computed
/// from the latest weight) and see the day's burn. Reports the RAW burned kcal up
/// to the parent so the food day can show the eat-back-adjusted target (hybrid).
/// Collapsed by default; never nags — purely additive to the day.
export function WorkoutSection({ db, onChange }: { db: Db; onChange?: (rawKcal: number) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rows, setRows] = useState<WorkoutRow[]>([]);
  const [weightKg, setWeightKg] = useState(70);
  const [type, setType] = useState<WorkoutType>('walk');
  const [minutes, setMinutes] = useState('');
  // Strength is logged in SETS («время не нужно») — a separate field so a
  // half-typed minute count survives switching chips back and forth.
  const [sets, setSets] = useState('');
  const [speed, setSpeed] = useState('');
  const [open, setOpen] = useState(false);
  // Free-text parse path.
  const [describe, setDescribe] = useState('');
  const [parsing, setParsing] = useState(false);
  // Transient result note under the free-text row: how many activities were added,
  // or an honest "couldn't parse". Cleared on the next edit.
  const [parseNote, setParseNote] = useState<string | null>(null);
  // Cross-border AI consent — mirrors app_settings; drives the just-in-time gate.
  const [aiConsent, setAiConsent] = useState(false);
  const [aiConsentVersion, setAiConsentVersion] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!db) return;
    const [list, w] = await Promise.all([listWorkoutsForDay(db), latestWeight(db)]);
    setRows(list);
    if (w && w.weightKg > 0) setWeightKg(w.weightKg);
    onChange?.(list.reduce((s, r) => s + Number(r.kcal), 0));
  }, [db, onChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Load the AI-consent state once so the free-text button can gate correctly.
  useEffect(() => {
    if (!db || !AI_CONFIGURED) return;
    void (async () => {
      const s = await ensureSettings(db);
      setAiConsent(s.aiFoodParseConsent);
      setAiConsentVersion(s.aiFoodParseConsentVersion);
    })();
  }, [db]);

  async function add() {
    if (!db) return;
    if (supportsSets(type)) {
      // Strength: sets → estimated minutes (~3 min each incl. rest); no stopwatch.
      const n = Number(sets.replace(',', '.'));
      const min = setsToMinutes(n);
      if (!(min > 0)) return;
      await addWorkout(db, type, min, weightKg, null, new Date(), Math.round(n));
      setSets('');
    } else {
      const min = Number(minutes.replace(',', '.'));
      if (!Number.isFinite(min) || min <= 0) return;
      const kmh = supportsSpeed(type) ? Number(speed.replace(',', '.')) : NaN;
      const speedKmh = Number.isFinite(kmh) && kmh > 0 ? kmh : null;
      await addWorkout(db, type, min, weightKg, speedKmh);
      setMinutes('');
      setSpeed('');
    }
    await reload();
  }

  /// Run the free-text parse with a known consent value, add every activity, and
  /// leave an honest note. kcal is computed on-device in `addParsedWorkout`.
  async function runParse(consentNow: boolean) {
    const text = describe.trim();
    if (!db || text.length === 0) return;
    setParsing(true);
    setParseNote(null);
    try {
      const parser = getWorkoutParser(consentNow);
      const parsed = parser ? await parser.parse(text) : [];
      if (parsed.length === 0) {
        setParseNote(t('workouts.parseNone'));
        return;
      }
      for (const p of parsed) {
        await addParsedWorkout(
          db,
          {
            type: p.type,
            name_ru: p.name_ru,
            minutes: p.minutes,
            speedKmh: p.speed_kmh ?? null,
            met: p.met ?? null,
            sets: p.sets ?? null,
          },
          weightKg,
        );
      }
      setDescribe('');
      setParseNote(t('workouts.parseAdded', { count: parsed.length }));
      await reload();
    } finally {
      setParsing(false);
    }
  }

  /// Free-text submit: just-in-time cross-border consent first (only when an
  /// online parser exists and the user hasn't consented at the current version).
  async function onDescribe() {
    if (!db || describe.trim().length === 0) return;
    if (AI_CONFIGURED && needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
      setConsentOpen(true);
      return;
    }
    await runParse(aiConsent);
  }

  async function onConsentAccept() {
    setConsentOpen(false);
    if (db) await grantAiConsent(db);
    setAiConsent(true);
    setAiConsentVersion(AI_CONSENT_VERSION);
    await runParse(true);
  }

  function onConsentDecline() {
    setConsentOpen(false);
    setParseNote(t('workouts.parseDeclined'));
  }

  async function remove(id: number) {
    if (!db) return;
    await deleteWorkout(db, id);
    await reload();
  }

  const totalRaw = rows.reduce((s, r) => s + Number(r.kcal), 0);
  const counted = Math.round(totalRaw * EATBACK_FRACTION);

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.head} hitSlop={6}>
        <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('workouts.title')}</Text>
        <Text style={[styles.summary, { color: theme.subtle }, theme.font.body]}>
          {totalRaw > 0 ? t('workouts.summary', { kcal: Math.round(totalRaw), counted }) : t('workouts.summaryEmpty')}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tertiary} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <View style={styles.chips}>
            {WORKOUT_TYPES.map((w) => {
              const active = type === w;
              return (
                <Pressable
                  key={w}
                  onPress={() => setType(w)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: active ? theme.primary : theme.card,
                      borderColor: active ? theme.primary : theme.separator,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                    {t(`workouts.type.${w}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.addRow}>
            {supportsSets(type) ? (
              <>
                <TextField
                  value={sets}
                  onChangeText={setSets}
                  keyboardType="numeric"
                  placeholder={t('workouts.setsPlaceholder')}
                  style={styles.minInput}
                />
                <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('workouts.setsUnit')}</Text>
              </>
            ) : (
              <>
                <TextField
                  value={minutes}
                  onChangeText={setMinutes}
                  keyboardType="numeric"
                  placeholder={t('workouts.minutes')}
                  style={styles.minInput}
                />
                <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('workouts.min')}</Text>
              </>
            )}
            <Pressable
              onPress={() => void add()}
              accessibilityRole="button"
              accessibilityLabel={t('workouts.add')}
              style={({ pressed }) => [styles.addBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.addBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                {t('workouts.add')}
              </Text>
            </Pressable>
          </View>

          {supportsSets(type) ? (
            <Text style={[styles.setsHint, { color: theme.tertiary }, theme.font.body]}>
              {t('workouts.setsHint')}
            </Text>
          ) : null}

          {supportsSpeed(type) ? (
            <View style={styles.speedRow}>
              <TextField
                value={speed}
                onChangeText={setSpeed}
                keyboardType="numeric"
                placeholder={t('workouts.speedHint', { n: type === 'walk' ? 5 : type === 'run' ? 10 : 20 })}
                style={styles.minInput}
              />
              <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('workouts.kmh')}</Text>
              <Text style={[styles.speedOptional, { color: theme.tertiary }, theme.font.body]} numberOfLines={2}>
                {t('workouts.speedOptional')}
              </Text>
            </View>
          ) : null}

          {AI_CONFIGURED ? (
            <View style={styles.describeBlock}>
              <Text style={[styles.describeLabel, { color: theme.subtle }, theme.font.body]}>
                {t('workouts.describeLabel')}
              </Text>
              <TextField
                value={describe}
                onChangeText={(v) => {
                  setDescribe(v);
                  if (parseNote) setParseNote(null);
                }}
                placeholder={t('workouts.describeHint')}
                multiline
                style={styles.describeInput}
              />
              <Pressable
                onPress={() => void onDescribe()}
                disabled={parsing || describe.trim().length === 0}
                accessibilityRole="button"
                accessibilityLabel={t('workouts.describeAction')}
                style={({ pressed }) => [
                  styles.describeBtn,
                  {
                    backgroundColor: theme.primary,
                    opacity: parsing || describe.trim().length === 0 ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.addBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                  {parsing ? t('workouts.parsing') : t('workouts.describeAction')}
                </Text>
              </Pressable>
              {parseNote ? (
                <Text style={[styles.parseNote, { color: theme.subtle }, theme.font.body]}>{parseNote}</Text>
              ) : null}
            </View>
          ) : null}

          {rows.length > 0 ? (
            <View style={styles.list}>
              {rows.map((r) => (
                <View key={r.id} style={styles.item}>
                  <Text style={[styles.itemName, { color: theme.text }, theme.font.body]} numberOfLines={1}>
                    {r.label ? r.label : t(`workouts.type.${r.type}`)} ·{' '}
                    {r.sets != null && r.sets > 0
                      ? t('workouts.setsCount', { count: r.sets })
                      : `${r.minutes} ${t('workouts.min')}`}
                    {r.speedKmh ? ` · ${Math.round(r.speedKmh * 10) / 10} ${t('workouts.kmh')}` : ''}
                  </Text>
                  <Text style={[styles.itemKcal, { color: theme.subtle }, theme.font.body]}>
                    {r.type === 'other' ? '≈ ' : ''}
                    {Math.round(r.kcal)} {t('units.kcal')}
                  </Text>
                  <Pressable
                    onPress={() => void remove(r.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('workouts.remove')}
                  >
                    <Ionicons name="close" size={16} color={theme.tertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('workouts.note')}</Text>
        </View>
      ) : null}

      <ConsentModal
        visible={consentOpen}
        title={t('consent.workout.title')}
        body={t('consent.workout.body')}
        confirmLabel={t('consent.workout.accept')}
        declineLabel={t('consent.workout.decline')}
        declineCaption={t('consent.workout.declineCaption')}
        onConfirm={() => void onConsentAccept()}
        onDecline={onConsentDecline}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15 },
  summary: { fontSize: 13, flex: 1, textAlign: 'right' },
  body: { marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  speedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  setsHint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  minInput: { width: 90 },
  unit: { fontSize: 13 },
  speedOptional: { fontSize: 12, flex: 1, lineHeight: 16 },
  addBtn: { marginLeft: 'auto', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  addBtnText: { fontSize: 14 },
  describeBlock: { marginTop: 16, gap: 8 },
  describeLabel: { fontSize: 13 },
  describeInput: { minHeight: 64 },
  describeBtn: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  parseNote: { fontSize: 12, lineHeight: 17 },
  list: { marginTop: 12, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemName: { fontSize: 13, flex: 1 },
  itemKcal: { fontSize: 13 },
  note: { fontSize: 12, marginTop: 12, lineHeight: 17 },
});
