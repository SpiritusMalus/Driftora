import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { AI_CONSENT_VERSION, grantAiConsent, needsAiConsent } from '@/lib/core/consent/consent';
import type { WorkoutRow } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { latestWeight } from '@/lib/core/db/weight';
import {
  addParsedWorkout,
  addTrackerWorkout,
  addWorkout,
  deleteWorkout,
  listWorkoutsForDay,
  quickWorkoutKcal,
  quickWorkouts,
  repeatWorkout,
  type QuickWorkout,
} from '@/lib/core/db/workouts';
import {
  EATBACK_FRACTION,
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
import {
  isAudioRecordingAvailable,
  isSilentRecording,
  startRecording,
  type ActiveRecording,
} from '@/lib/core/services/audioRecorder';
import type { AudioInput, PhotoInput } from '@/lib/core/services/foodParser';
import { capturePhoto, isPhotoCaptureAvailable } from '@/lib/core/services/photoProvider';
import { deleteTempFile } from '@/lib/core/services/tempFiles';
import {
  getWorkoutParser,
  isWorkoutParserConfigured,
  type ParsedWorkout,
} from '@/lib/core/services/workoutParser';
import { budgetKcal, formatWorkoutLine, formatWorkoutValue } from '@/lib/i18n/formatWorkout';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Whether an online AI parser is configured for this build (env at bundle time).
const AI_CONFIGURED = isWorkoutParserConfigured();

/// The three input paths, shown one at a time via a segmented control instead of
/// three stacked, equally-loud boxes (they used to overflow the screen). Order =
/// primary → optional import → free-text. «ai» is hidden when unconfigured.
const WORKOUT_MODES = ['exact', 'tracker', 'ai'] as const;
type WorkoutMode = (typeof WORKOUT_MODES)[number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;


/// «Тренировки сегодня» — log a workout (type + minutes → kcal via MET, computed
/// from the latest weight) and see the day's burn. Reports the RAW burned kcal up
/// to the parent so the food day can show the eat-back-adjusted target (hybrid).
/// Collapsed by default ([initiallyOpen] unfolds it for direct entries, e.g. the
/// «Тренировки» menu row); never nags — purely additive to the day.
export function WorkoutSection({
  db,
  onChange,
  initiallyOpen = false,
}: {
  db: Db;
  onChange?: (rawKcal: number) => void;
  initiallyOpen?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rows, setRows] = useState<WorkoutRow[]>([]);
  // «Повторить»: what the user has already logged, one tap away — the fast path
  // past the whole form (device feedback 2026-07-21: «чтобы заново не вписывать»).
  const [quick, setQuick] = useState<QuickWorkout[]>([]);
  const [repeating, setRepeating] = useState(false);
  const [weightKg, setWeightKg] = useState(70);
  // Whether a real weigh-in backs the kcal math. Without one we fall back to
  // 70 kg — say so instead of silently mis-scaling a 100 kg user by 30%.
  const [hasWeight, setHasWeight] = useState(true);
  // The user's OWN cost of merely existing, subtracted from every MET estimate.
  // Byrne 2005's recommendation over the 1-MET convention, which overstates rest
  // by ~19% on average and more at high BMI. Falls back to the population value
  // until the body profile is complete — see [restingRateForProfile].
  const [restingRate, setRestingRate] = useState(POPULATION_RESTING_KCAL_PER_KG_H);
  const [type, setType] = useState<WorkoutType>('walk');
  const [minutes, setMinutes] = useState('');
  // Strength is logged in SETS («время не нужно») — a separate field so a
  // half-typed minute count survives switching chips back and forth.
  const [sets, setSets] = useState('');
  const [speed, setSpeed] = useState('');
  // Strength effort → MET (light/moderate/heavy). Defaults to «средняя»: a typical
  // gym session, not the light-isolation floor the flat 3.5 used to assume.
  const [intensity, setIntensity] = useState<StrengthIntensity>('moderate');
  // «По часам»: a kcal number typed straight off a watch/tracker — stored
  // verbatim (no MET math of ours), the standalone model's optional import path.
  // Not a criterion measure: wrist devices miss energy expenditure by >30% MAPE,
  // so it is shown with «≈» like everything else.
  const [trackerKcal, setTrackerKcal] = useState('');
  const [open, setOpen] = useState(initiallyOpen);
  // Which input path is visible (segmented control). Defaults to the primary
  // manual entry; «tracker»/«ai» are the optional paths.
  const [mode, setMode] = useState<WorkoutMode>('exact');
  // The honest burn-math note is quiet by default — one line always, the full
  // explanation (72 %, resting subtraction, «по трекеру») a tap away.
  const [noteOpen, setNoteOpen] = useState(false);
  // Free-text parse path.
  const [describe, setDescribe] = useState('');
  const [parsing, setParsing] = useState(false);
  // Transient result note under the free-text row: how many activities were added,
  // or an honest "couldn't parse". Cleared on the next edit.
  const [parseNote, setParseNote] = useState<string | null>(null);
  // «Не показывать калории» — the same app_settings switch the food, review and
  // history screens already honour. Workouts were the one budget surface that
  // ignored it, so a user who asked for no calories still met them on the home
  // screen. It hides the user's OWN numbers, not the method: the «как считаем»
  // explainer stays, since it describes the model rather than their day.
  const [hideCalories, setHideCalories] = useState(false);
  // Cross-border AI consent — mirrors app_settings; drives the just-in-time gate.
  const [aiConsent, setAiConsent] = useState(false);
  const [aiConsentVersion, setAiConsentVersion] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  // The upload that asked for consent — resumed on accept (text, voice or photo).
  const pendingRun = useRef<((consentNow: boolean) => Promise<void>) | null>(null);
  // Voice note: the live recording session, if any.
  const [recording, setRecording] = useState<ActiveRecording | null>(null);
  const [photoReady, setPhotoReady] = useState(false);
  const micReady = isAudioRecordingAvailable();
  // The teaching moment after any successful log: «+N ккал к бюджету сегодня» —
  // the user must SEE that a workout raises the day, not infer it.
  const [budgetAck, setBudgetAck] = useState<string | null>(null);
  const budgetAckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (budgetAckTimer.current) clearTimeout(budgetAckTimer.current);
    },
    [],
  );

  function ackBudget(rawKcal: number) {
    const add = Math.round(Math.max(0, rawKcal) * EATBACK_FRACTION);
    if (add <= 0) return;
    setBudgetAck(hideCalories ? t('workouts.budgetAckNoKcal') : t('workouts.budgetAck', { kcal: add }));
    if (budgetAckTimer.current) clearTimeout(budgetAckTimer.current);
    budgetAckTimer.current = setTimeout(() => setBudgetAck(null), 6000);
  }

  const reload = useCallback(async () => {
    if (!db) return;
    const [list, w, repeats, s] = await Promise.all([
      listWorkoutsForDay(db),
      latestWeight(db),
      quickWorkouts(db),
      ensureSettings(db),
    ]);
    setRows(list);
    setQuick(repeats);
    const weighed = w != null && w.weightKg > 0;
    const kg = weighed ? w.weightKg : weightKg;
    if (weighed) setWeightKg(w.weightKg);
    setHasWeight(weighed);
    // Resting rate rides along with the weight it was derived from, so the two
    // never disagree inside one estimate.
    setRestingRate(
      restingRateForProfile(
        {
          sex: s.sex,
          birthYear: s.birthYear,
          heightCm: s.heightCm,
          activityLevel: s.activityLevel,
          bodyFatPct: s.bodyFatPct,
          waistCm: s.waistCm,
          bmrFactor: s.bmrFactor,
        },
        kg,
      ),
    );
    onChange?.(list.reduce((s2, r) => s2 + Number(r.kcal), 0));
  }, [db, onChange, weightKg]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Settings this card reacts to: the calorie-visibility switch (always), and
  // the AI-consent state so the free-text button can gate correctly.
  useEffect(() => {
    if (!db) return;
    void (async () => {
      const s = await ensureSettings(db);
      setHideCalories(s.hideCalories);
      if (!AI_CONFIGURED) return;
      setAiConsent(s.aiFoodParseConsent);
      setAiConsentVersion(s.aiFoodParseConsentVersion);
    })();
  }, [db]);

  // Whether the system photo picker exists in this build (async probe).
  useEffect(() => {
    if (!AI_CONFIGURED) return;
    void isPhotoCaptureAvailable().then(setPhotoReady);
  }, []);

  // A recording must not outlive the screen — cancel on unmount.
  useEffect(
    () => () => {
      void recording?.cancel();
    },
    [recording],
  );

  /// One line describing a workout — «Силовая · 12 подх. · Средняя». Shared by
  /// the day's list, the repeat chips AND the history screen: a past session has
  /// to read back exactly as it read the day it was logged, which is why the
  /// formatter lives in [lib/i18n/formatWorkout] rather than in this component.
  const describeWorkout = (w: Parameters<typeof formatWorkoutLine>[0]) => formatWorkoutLine(w, t);

  /// One tap logs a past workout again for today — no form, no typing. kcal is
  /// recomputed from the CURRENT weight for known types (see [repeatWorkout]),
  /// so the chip's number and the stored one agree.
  async function onRepeat(q: QuickWorkout) {
    if (!db || repeating) return;
    setRepeating(true);
    try {
      ackBudget(await repeatWorkout(db, q, weightKg, new Date(), restingRate));
      await reload();
    } finally {
      setRepeating(false);
    }
  }

  async function add() {
    if (!db) return;
    if (supportsSets(type)) {
      // Strength: sets → estimated minutes (~3 min each incl. rest); no stopwatch.
      // Effort level picks the MET (light/moderate/heavy).
      const n = Number(sets.replace(',', '.'));
      const min = setsToMinutes(n);
      if (!(min > 0)) return;
      ackBudget(
        await addWorkout(db, type, min, weightKg, null, new Date(), Math.round(n), intensity, restingRate),
      );
      setSets('');
    } else {
      const min = Number(minutes.replace(',', '.'));
      if (!Number.isFinite(min) || min <= 0) return;
      const kmh = supportsSpeed(type) ? Number(speed.replace(',', '.')) : NaN;
      const speedKmh = Number.isFinite(kmh) && kmh > 0 ? kmh : null;
      ackBudget(await addWorkout(db, type, min, weightKg, speedKmh, new Date(), null, null, restingRate));
      setMinutes('');
      setSpeed('');
    }
    await reload();
  }

  /// «По часам»: log a measured kcal number typed straight off a tracker/watch.
  /// Stored verbatim via [addTrackerWorkout] — none of our MET math — and marked
  /// «по трекеру», like the screenshot path. Still shown with «≈»: a watch's
  /// calorie figure is an estimate too, and a poorly validated one.
  async function addTracker() {
    if (!db) return;
    const kcal = Number(trackerKcal.replace(',', '.'));
    if (!(Number.isFinite(kcal) && kcal > 0)) return;
    ackBudget(
      await addTrackerWorkout(db, { kcal, minutes: 0, type: 'other', label: t('workouts.fromTracker') }),
    );
    setTrackerKcal('');
    await reload();
  }

  /// Persist a parsed activity list with an honest note. kcal is computed
  /// on-device in `addParsedWorkout` — shared by the text, voice and photo paths.
  async function saveParsed(parsed: ParsedWorkout[]) {
    if (!db) return;
    if (parsed.length === 0) {
      setParseNote(t('workouts.parseNone'));
      return;
    }
    let raw = 0;
    for (const p of parsed) {
      raw += await addParsedWorkout(
        db,
        {
          type: p.type,
          name_ru: p.name_ru,
          minutes: p.minutes,
          speedKmh: p.speed_kmh ?? null,
          met: p.met ?? null,
          sets: p.sets ?? null,
          intensity: p.intensity ?? null,
        },
        weightKg,
        new Date(),
        restingRate,
      );
    }
    setDescribe('');
    setParseNote(t('workouts.parseAdded', { count: parsed.length }));
    ackBudget(raw);
    await reload();
  }

  /// Just-in-time cross-border consent shared by every upload path: with consent
  /// already held the runner fires now, otherwise it parks in `pendingRun` and
  /// resumes on accept.
  async function withConsent(run: (consentNow: boolean) => Promise<void>) {
    if (AI_CONFIGURED && needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
      pendingRun.current = run;
      setConsentOpen(true);
      return;
    }
    await run(aiConsent);
  }

  async function runParse(consentNow: boolean) {
    const text = describe.trim();
    if (!db || text.length === 0) return;
    setParsing(true);
    setParseNote(null);
    try {
      const parser = getWorkoutParser(consentNow);
      await saveParsed(parser ? await parser.parse(text) : []);
    } finally {
      setParsing(false);
    }
  }

  async function onDescribe() {
    if (!db || describe.trim().length === 0) return;
    await withConsent(runParse);
  }

  /// Voice note: first tap starts recording, second stops it and sends the clip
  /// through the same parse→save path as text.
  async function onMic() {
    if (!db || parsing) return;
    if (recording) {
      const rec = recording;
      setRecording(null);
      const clip = await rec.stop();
      if (!clip) {
        setParseNote(t('workouts.voiceFailed'));
        return;
      }
      // A silent clip means the mic delivered nothing (muted in the system /
      // held by another app) — say so instead of parsing silence.
      if (isSilentRecording(rec.peakLevel())) {
        deleteTempFile(clip.uri);
        setParseNote(t('workouts.voiceSilent'));
        return;
      }
      await withConsent((c) => runVoiceParse(clip, c));
      return;
    }
    setParseNote(null);
    const started = await startRecording();
    if (started.error) {
      // Denied and "granted but wouldn't start" need different advice.
      setParseNote(t(started.error === 'denied' ? 'workouts.voiceUnavailable' : 'workouts.micBusy'));
      return;
    }
    setRecording(started.recording);
  }

  async function runVoiceParse(clip: AudioInput, consentNow: boolean) {
    setParsing(true);
    setParseNote(null);
    try {
      const parser = getWorkoutParser(consentNow);
      await saveParsed(parser ? await parser.parseAudio(clip) : []);
    } finally {
      setParsing(false);
      // The recorded m4a was only ever needed for the upload — clean it up on
      // every path so the cache doesn't grow a file per voice note (mirrors
      // the food log's cleanup).
      deleteTempFile(clip.uri);
    }
  }

  /// Tracker screenshot from the gallery. If the tracker printed its own total
  /// kcal, THAT number is logged verbatim («по трекеру») — the watch measured
  /// it, we don't out-guess it. Otherwise the activities go the usual MET path.
  async function onScreenshot() {
    if (!db || parsing) return;
    const res = await capturePhoto('library');
    if (res.status === 'cancelled') return;
    if (res.status !== 'ok') {
      setParseNote(t('workouts.photoFailed'));
      return;
    }
    await withConsent((c) => runPhotoParse(res.photos[0]!, c));
  }

  async function runPhotoParse(photo: PhotoInput, consentNow: boolean) {
    if (!db) return;
    setParsing(true);
    setParseNote(null);
    try {
      const parser = getWorkoutParser(consentNow);
      const parsed = parser ? await parser.parsePhoto(photo) : { workouts: [] };
      if (parsed.device_kcal != null && parsed.device_kcal > 0) {
        const names = parsed.workouts.map((w) => w.name_ru).filter(Boolean).join(', ');
        const single = parsed.workouts.length === 1 ? parsed.workouts[0] : null;
        const minutes =
          parsed.device_minutes ?? parsed.workouts.reduce((s, w) => s + Math.max(0, w.minutes), 0);
        // The toast and the budget ack must speak the STORED number: the db
        // clamps an OCR misread to a sane band, and «записываем ровно его
        // цифру» would otherwise show a kcal that was never saved.
        const storedKcal = await addTrackerWorkout(db, {
          kcal: parsed.device_kcal,
          minutes,
          type: single?.type ?? 'other',
          label: names ? `${names} · ${t('workouts.fromTracker')}` : t('workouts.fromTracker'),
          sets: single?.sets ?? null,
        });
        setParseNote(t('workouts.trackerAdded'));
        ackBudget(storedKcal);
        await reload();
        return;
      }
      await saveParsed(parsed.workouts);
    } finally {
      setParsing(false);
      // Same cleanup as the voice path, for the downscaled screenshot JPEG.
      deleteTempFile(photo.uri);
    }
  }

  async function onConsentAccept() {
    setConsentOpen(false);
    if (db) await grantAiConsent(db);
    setAiConsent(true);
    setAiConsentVersion(AI_CONSENT_VERSION);
    const run = pendingRun.current ?? runParse;
    pendingRun.current = null;
    await run(true);
  }

  function onConsentDecline() {
    setConsentOpen(false);
    pendingRun.current = null;
    setParseNote(t('workouts.parseDeclined'));
  }

  async function remove(id: number) {
    if (!db) return;
    await deleteWorkout(db, id);
    await reload();
  }

  // The ✕ is a tiny target and the delete silently reshapes the day's budget —
  // ask first, exactly like the food and diary deletes do.
  function confirmRemove(id: number) {
    Alert.alert(t('workouts.removeConfirmTitle'), t('workouts.removeConfirmBody'), [
      { text: t('workouts.removeCancel'), style: 'cancel' },
      { text: t('workouts.remove'), style: 'destructive', onPress: () => void remove(id) },
    ]);
  }

  const totalRaw = rows.reduce((s, r) => s + Number(r.kcal), 0);
  const counted = Math.round(totalRaw * EATBACK_FRACTION);

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.head} hitSlop={6}>
        <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('workouts.title')}</Text>
        <Text style={[styles.summary, { color: theme.subtle }, theme.font.body]}>
          {totalRaw <= 0
            ? t('workouts.summaryEmpty')
            : hideCalories
              ? t('workouts.summaryNoKcal', { count: rows.length })
              : t('workouts.summary', { kcal: counted })}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tertiary} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {budgetAck ? (
            <Text style={[styles.budgetAck, { color: theme.accent }, theme.font.bodyMedium]}>{budgetAck}</Text>
          ) : null}
          {/* «Повторить» — the fast path, above the form: what's already been
              logged goes in with one tap instead of being re-entered. Its own
              uppercase label (the food log's «Быстро» idiom) keeps it from
              reading as a third row of the chips/segments below. */}
          {quick.length > 0 ? (
            <View style={styles.repeat}>
              <Text style={[styles.repeatLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
                {t('workouts.repeat.label').toUpperCase()}
              </Text>
              <View style={styles.repeatWrap}>
                {quick.map((q, i) => {
                  const name = describeWorkout(q);
                  return (
                    <Pressable
                      key={i}
                      onPress={() => void onRepeat(q)}
                      disabled={repeating}
                      accessibilityRole="button"
                      accessibilityLabel={t('workouts.repeat.a11y', { name })}
                      style={({ pressed }) => [
                        styles.repeatChip,
                        {
                          backgroundColor: theme.card,
                          borderColor: theme.separator,
                          opacity: repeating ? 0.5 : pressed ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[styles.repeatChipText, { color: theme.text }, theme.font.bodySemiBold]}
                      >
                        {name}
                      </Text>
                      {hideCalories ? null : (
                        <Text style={[styles.repeatChipKcal, { color: theme.subtle }, theme.font.body]}>
                          {/* Same currency as the log rows: what the repeat
                              would ADD to the budget, not what it burns. */}
                          ≈ {budgetKcal(quickWorkoutKcal(q, weightKg, restingRate))}{' '}
                          {t('units.kcal')}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <View style={[styles.repeatRule, { backgroundColor: theme.separator }]} />
            </View>
          ) : null}

          {/* One input path at a time. The switcher is ONE steel track with the
              segments inside (no per-segment borders) — earlier the three
              segments were free-floating pills and read as a second row of the
              type chips below (device feedback 2026-07-21: «визуально не
              отделены»). The connected track is what says «это переключатель». */}
          <View style={[styles.segments, { backgroundColor: theme.iconBg }]}>
            {WORKOUT_MODES.map((m) => {
              if (m === 'ai' && !AI_CONFIGURED) return null;
              const active = mode === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.segment,
                    {
                      backgroundColor: active ? theme.primary : 'transparent',
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: active ? theme.onPrimary : theme.subtle },
                      active ? theme.font.bodySemiBold : theme.font.body,
                    ]}
                  >
                    {t(`workouts.mode.${m}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {mode === 'exact' ? (
            <View style={styles.modeSection}>
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
              </View>

              {supportsIntensity(type) ? (
                <View style={styles.intensityRow}>
                  <Text style={[styles.intensityLabel, { color: theme.subtle }, theme.font.body]}>
                    {t('workouts.intensity.label')}
                  </Text>
                  <View style={styles.intensityChips}>
                    {STRENGTH_INTENSITIES.map((lv) => {
                      const active = intensity === lv;
                      return (
                        <Pressable
                          key={lv}
                          onPress={() => setIntensity(lv)}
                          style={({ pressed }) => [
                            styles.effortChip,
                            {
                              backgroundColor: active ? theme.primary : theme.card,
                              borderColor: active ? theme.primary : theme.separator,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.effortChipText,
                              { color: active ? theme.onPrimary : theme.text },
                              theme.font.body,
                            ]}
                          >
                            {t(`workouts.intensity.${lv}`)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

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

              {!hasWeight ? (
                <Text style={[styles.setsHint, { color: theme.tertiary }, theme.font.body]}>
                  {t('workouts.weightFallback', { kg: weightKg })}
                </Text>
              ) : null}

              {/* «Добавить» spans the row BELOW every input so the primary action
                  is the last thing after minutes/sets, intensity and pace — not
                  floating mid-card above the km/h field (device-visible fix). */}
              <Pressable
                onPress={() => void add()}
                accessibilityRole="button"
                accessibilityLabel={t('workouts.add')}
                style={({ pressed }) => [
                  styles.exactAddBtn,
                  { backgroundColor: theme.primary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.addBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                  {t('workouts.add')}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {/* «По часам» — the optional import path: a measured kcal number from a
              watch/tracker, stored verbatim (none of our MET math), marked «по трекеру». The
              app stays standalone; this just lets a measured number in. */}
          {mode === 'tracker' ? (
            <View style={styles.modeSection}>
              {/* What this mode IS — the locale line existed but never rendered,
                  so the mode read as a bare mystery field (device feedback
                  2026-07-21: «что имеется в виду „с трекера“»). */}
              <Text style={[styles.trackerHead, { color: theme.subtle }, theme.font.body]}>
                {t('workouts.tracker.head')}
              </Text>
              <View style={styles.addRow}>
                <TextField
                  value={trackerKcal}
                  onChangeText={setTrackerKcal}
                  keyboardType="numeric"
                  placeholder={t('workouts.tracker.kcalPlaceholder')}
                  style={styles.minInput}
                />
                <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('units.kcal')}</Text>
                <Pressable
                  onPress={() => void addTracker()}
                  disabled={!(Number(trackerKcal.replace(',', '.')) > 0)}
                  accessibilityRole="button"
                  accessibilityLabel={t('workouts.add')}
                  style={({ pressed }) => [
                    styles.addBtn,
                    {
                      backgroundColor: theme.primary,
                      opacity: !(Number(trackerKcal.replace(',', '.')) > 0) ? 0.5 : pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.addBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                    {t('workouts.add')}
                  </Text>
                </Pressable>
              </View>
              <Text style={[styles.setsHint, { color: theme.tertiary }, theme.font.body]}>
                {t('workouts.tracker.hint')}
              </Text>
            </View>
          ) : null}

          {mode === 'ai' && AI_CONFIGURED ? (
            <View style={styles.modeSection}>
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
              <View style={styles.describeActions}>
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
                {micReady ? (
                  <Pressable
                    onPress={() => void onMic()}
                    disabled={parsing}
                    accessibilityRole="button"
                    accessibilityLabel={t(recording ? 'workouts.voiceStop' : 'workouts.voiceStart')}
                    style={({ pressed }) => [
                      styles.iconBtn,
                      {
                        backgroundColor: recording ? theme.primary : theme.card,
                        borderColor: recording ? theme.primary : theme.separator,
                        opacity: parsing ? 0.5 : pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={recording ? 'stop' : 'mic-outline'}
                      size={18}
                      color={recording ? theme.onPrimary : theme.primary}
                    />
                  </Pressable>
                ) : null}
                {photoReady ? (
                  <Pressable
                    onPress={() => void onScreenshot()}
                    disabled={parsing || recording != null}
                    accessibilityRole="button"
                    accessibilityLabel={t('workouts.screenshot')}
                    style={({ pressed }) => [
                      styles.iconBtn,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.separator,
                        opacity: parsing || recording != null ? 0.5 : pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Ionicons name="image-outline" size={18} color={theme.primary} />
                  </Pressable>
                ) : null}
              </View>
              {micReady || photoReady ? (
                /* The mic/photo buttons are icon-only — say out loud that voice
                   and a tracker screenshot work here (device feedback
                   2026-07-21: «не очевидно, что можно фото приложить»). */
                <Text style={[styles.setsHint, { color: theme.tertiary }, theme.font.body]}>
                  {t('workouts.describeMedia')}
                </Text>
              ) : null}
              {recording ? (
                <Text style={[styles.parseNote, { color: theme.primary }, theme.font.bodyMedium]}>
                  {t('workouts.voiceRecording')}
                </Text>
              ) : null}
              {parseNote ? (
                <Text style={[styles.parseNote, { color: theme.subtle }, theme.font.body]}>{parseNote}</Text>
              ) : null}
            </View>
          ) : null}

          {rows.length > 0 ? (
            <View style={styles.list}>
              {rows.map((r) => (
                <View key={r.id}>
                  <View style={styles.item}>
                    <Text style={[styles.itemName, { color: theme.text }, theme.font.body]} numberOfLines={1}>
                      {describeWorkout(r)}
                    </Text>
                    {hideCalories ? null : (
                      <Text style={[styles.itemKcal, { color: theme.subtle }, theme.font.body]}>
                        {formatWorkoutValue(r, t, false)}
                      </Text>
                    )}
                    <Pressable
                      onPress={() => confirmRemove(r.id)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('workouts.remove')}
                    >
                      <Ionicons name="close" size={16} color={theme.tertiary} />
                    </Pressable>
                  </View>
                  {/* The double-count fix, said out loud: these steps moved into
                      the workout's kcal and left the step earnings. */}
                  {r.source === 'device' && r.stepsInWindow != null && r.stepsInWindow > 0 ? (
                    <Text style={[styles.itemSub, { color: theme.tertiary }, theme.font.body]}>
                      {t('workouts.stepsInside', { steps: r.stepsInWindow })}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Honest burn-math kept but quiet: one line always, the full
              explanation (72 %, resting subtraction, «по трекеру») a tap away. */}
          <Pressable onPress={() => setNoteOpen((v) => !v)} style={styles.noteHead} hitSlop={6}>
            <Text style={[styles.noteShort, { color: theme.subtle }, theme.font.body]}>{t('workouts.noteShort')}</Text>
            <Text style={[styles.noteToggle, { color: theme.tertiary }, theme.font.body]}>{t('workouts.noteToggle')}</Text>
            <Ionicons name={noteOpen ? 'chevron-up' : 'chevron-down'} size={14} color={theme.tertiary} />
          </Pressable>
          {noteOpen ? (
            <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('workouts.note')}</Text>
          ) : null}
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
  segments: { flexDirection: 'row', gap: 3, padding: 3, borderRadius: 12 },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  segmentText: { fontSize: 13 },
  modeSection: { marginTop: 14 },
  exactAddBtn: { marginTop: 14, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  noteShort: { fontSize: 12, lineHeight: 17, flex: 1 },
  noteToggle: { fontSize: 12 },
  title: { fontSize: 15 },
  summary: { fontSize: 13, flex: 1, textAlign: 'right' },
  body: { marginTop: 12 },
  budgetAck: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  repeat: { marginBottom: 14 },
  repeatLabel: { fontSize: 12, letterSpacing: 1.44, marginBottom: 8 },
  repeatWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  repeatChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  repeatChipText: { fontSize: 14, maxWidth: 240 },
  repeatChipKcal: { fontSize: 11, marginTop: 2 },
  // Closes the fast-path group off from the form below it.
  repeatRule: { height: StyleSheet.hairlineWidth, marginTop: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13 },
  intensityRow: { marginTop: 12, gap: 8 },
  intensityLabel: { fontSize: 12 },
  intensityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  effortChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  effortChipText: { fontSize: 13 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  speedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  setsHint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  minInput: { width: 112 },
  trackerHead: { fontSize: 13, lineHeight: 18 },
  unit: { fontSize: 13 },
  speedOptional: { fontSize: 12, flex: 1, lineHeight: 16 },
  addBtn: { marginLeft: 'auto', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  addBtnText: { fontSize: 14 },
  describeInput: { minHeight: 64 },
  describeActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  describeBtn: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  iconBtn: { width: 38, height: 38, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  parseNote: { fontSize: 12, lineHeight: 17 },
  list: { marginTop: 12, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemName: { fontSize: 13, flex: 1 },
  itemKcal: { fontSize: 13 },
  itemSub: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  note: { fontSize: 12, marginTop: 12, lineHeight: 17 },
});
