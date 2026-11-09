import { usePreventRemove } from '@react-navigation/native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MoodScale } from '@/components/ui/MoodScale';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { getDiaryEntry, saveDiaryEntry, updateDiaryEntry, type Emotion } from '@/lib/core/db/diary';
import { DISTORTION_KEYS, type DistortionKey } from '@/lib/core/insights/distortions';
import { diarySteps, parseDiaryRating } from '@/lib/core/insights/diaryPattern';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The thought record, one gentle step at a time. Order tuned from user feedback
/// (2026-06-25): the automatic stuff first (situation, feeling, reaction), THEN
/// name the thought, rate belief, explore its personal meaning and self-belief,
/// then weigh it. Mood is rated before and after the record.

/// Serialized form state for the exit guard — one stable shape shared by the
/// blank baseline, the loaded-record baseline and the current values.
function snapshot(v: {
  situation: string;
  thoughts: string;
  emotions: Emotion[];
  reactionBody: string;
  reactionBehavior: string;
  evidenceFor: string;
  evidenceAgainst: string;
  reframe: string;
  moodBefore: number | null;
  mood: number | null;
  distortions: DistortionKey[];
  thoughtBelief: string;
  meanings: string[];
  coreBelief: string;
  emotionName: string;
  emotionIntensity: string;
}): string {
  return JSON.stringify(v);
}

function blankSnapshot(): string {
  return snapshot({
    situation: '',
    thoughts: '',
    emotions: [],
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: '',
    moodBefore: null,
    mood: null,
    distortions: [],
    thoughtBelief: '',
    meanings: ['', ''],
    coreBelief: '',
    emotionName: '',
    emotionIntensity: '',
  });
}

export default function DiaryNewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  // Same screen edits an existing record when opened with ?id= (lower-risk than
  // lifting the whole stepper into a shared component): pre-fill from the stored
  // entry and switch Save → update, preserving the original ts.
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = id != null && id !== '' ? Number(id) : null;

  const [step, setStep] = useState(0);
  const [situation, setSituation] = useState('');
  const [thoughts, setThoughts] = useState('');
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [reactionBody, setReactionBody] = useState('');
  const [reactionBehavior, setReactionBehavior] = useState('');
  const [evidenceFor, setEvidenceFor] = useState('');
  const [evidenceAgainst, setEvidenceAgainst] = useState('');
  const [reframe, setReframe] = useState('');
  const [moodBefore, setMoodBefore] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [distortions, setDistortions] = useState<DistortionKey[]>([]);
  const [thoughtBelief, setThoughtBelief] = useState('');
  const [meanings, setMeanings] = useState<string[]>(['', '']);
  const [coreBelief, setCoreBelief] = useState('');
  const [emotionName, setEmotionName] = useState('');
  const [emotionIntensity, setEmotionIntensity] = useState('');
  const [emotionError, setEmotionError] = useState(false);
  const [beliefError, setBeliefError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set on successful save; navigation happens in an effect AFTER the re-render
  // so the exit guard below sees the form as clean and lets the back through.
  const [savedOk, setSavedOk] = useState(false);
  // What the wizard looked like before the user touched it: blank for a new
  // record, the stored values once an edit pre-fills. The exit guard compares
  // against this so system back can't silently destroy typed-in work — the
  // most effortful entry in the app (null until an edit's baseline is known).
  const [baseline, setBaseline] = useState<string | null>(editId == null ? blankSnapshot() : null);

  // When editing, load the record once and pre-fill every field.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db || editId == null || !Number.isFinite(editId)) return;
      const e = await getDiaryEntry(db, editId);
      if (!active || !e) return;
      setSituation(e.situation);
      setThoughts(e.thoughts);
      setEmotions(e.emotions);
      setReactionBody(e.reactionBody);
      setReactionBehavior(e.reactionBehavior);
      setEvidenceFor(e.evidenceFor);
      setEvidenceAgainst(e.evidenceAgainst);
      setReframe(e.reframe);
      setMoodBefore(e.moodBefore ?? null);
      setMood(e.mood);
      setDistortions(e.distortions);
      const loadedMeanings = [...e.meanings];
      while (loadedMeanings.length < 2) loadedMeanings.push('');
      setThoughtBelief(e.thoughtBelief == null ? '' : String(e.thoughtBelief));
      setMeanings(loadedMeanings);
      setCoreBelief(e.coreBelief);
      setBaseline(
        snapshot({
          situation: e.situation,
          thoughts: e.thoughts,
          emotions: e.emotions,
          reactionBody: e.reactionBody,
          reactionBehavior: e.reactionBehavior,
          evidenceFor: e.evidenceFor,
          evidenceAgainst: e.evidenceAgainst,
          reframe: e.reframe,
          moodBefore: e.moodBefore ?? null,
          mood: e.mood,
          distortions: e.distortions,
          thoughtBelief: e.thoughtBelief == null ? '' : String(e.thoughtBelief),
          meanings: loadedMeanings,
          coreBelief: e.coreBelief,
          emotionName: '',
          emotionIntensity: '',
        }),
      );
    })();
    return () => {
      active = false;
    };
  }, [db, editId]);

  const steps = diarySteps(meanings.length);
  const { key, meaningIndex = 0 } = steps[step];
  const isLast = step === steps.length - 1;
  // Don't force every field, but avoid saving an entirely empty record.
  const canSave =
    db != null &&
    ([situation, thoughts, reframe, reactionBody, reactionBehavior, evidenceFor, evidenceAgainst].some((value) => value.trim().length > 0) ||
      emotions.length > 0 || emotionName.trim().length > 0 || thoughtBelief.trim().length > 0 ||
      meanings.some((answer) => answer.trim().length > 0) || coreBelief.trim().length > 0);

  const navigation = useNavigation();
  const current = snapshot({
    situation,
    thoughts,
    emotions,
    reactionBody,
    reactionBehavior,
    evidenceFor,
    evidenceAgainst,
    reframe,
    moodBefore,
    mood,
    distortions,
    thoughtBelief,
    meanings,
    coreBelief,
    emotionName,
    emotionIntensity,
  });
  // Guard system back / header back while there is unsaved typed-in work.
  usePreventRemove(baseline != null && current !== baseline && !savedOk, ({ data }) => {
    Alert.alert(t('diary.discardTitle'), t('diary.discardBody'), [
      { text: t('diary.discardStay'), style: 'cancel' },
      {
        text: t('diary.discardLeave'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
  // ONE exit, ever. `useRouter()` may hand back a fresh object on a re-render,
  // and `router` sits in this effect's deps — so the `finally { setSaving(false) }`
  // right after `setSavedOk(true)` re-ran it and popped a SECOND screen. Four
  // screens deep (Главная → Разделы → Дневник → Новая запись) that unwound the
  // whole stack and dropped the writer out of the app onto the launcher, at the
  // end of a CBT entry — the worst possible moment to lose the app. The latch
  // makes the exit idempotent; canGoBack keeps it honest if this screen is ever
  // opened as the root (see body-setup for the same trap).
  const leaving = useRef(false);
  useEffect(() => {
    if (!savedOk || leaving.current) return;
    leaving.current = true;
    // Home, not '/diary': that route is pushed elsewhere, and replacing onto a
    // pushed route stacks a duplicate — the shape the back-stack test guards.
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [savedOk, router]);

  // Pending emotion fields belong to the form so Back and the exit guard keep
  // them. Next/Save commits a complete emotion even without a separate Add tap.
  function commitEmotion(): Emotion[] | null {
    if (!emotionName.trim() && !emotionIntensity.trim()) return emotions;
    const intensity = parseDiaryRating(emotionIntensity);
    if (!emotionName.trim() || intensity == null) {
      setEmotionError(true);
      setStep(steps.findIndex((item) => item.key === 'emotions'));
      return null;
    }
    const next = [...emotions, { name: emotionName.trim(), intensity }];
    setEmotions(next);
    setEmotionName('');
    setEmotionIntensity('');
    setEmotionError(false);
    return next;
  }

  function validateBelief(): boolean {
    if (thoughtBelief.trim() && parseDiaryRating(thoughtBelief) == null) {
      setBeliefError(true);
      setStep(steps.findIndex((item) => item.key === 'belief'));
      return false;
    }
    return true;
  }

  function onNext() {
    if (key === 'emotions' && commitEmotion() == null) return;
    if (key === 'belief' && !validateBelief()) return;
    setStep(step + 1);
  }

  async function onSave() {
    if (!db || saving) return;
    const savedEmotions = commitEmotion();
    if (savedEmotions == null || !validateBelief()) return;
    setSaveError(false);
    setSaving(true);
    try {
      const draft = {
        situation,
        thoughts,
        emotions: savedEmotions,
        reactionBody,
        reactionBehavior,
        evidenceFor,
        evidenceAgainst,
        reframe,
        moodBefore,
        mood,
        distortions,
        thoughtBelief: parseDiaryRating(thoughtBelief),
        meanings,
        coreBelief,
      };
      // Editing preserves the original ts (no ts arg); a new record gets now().
      if (editId != null) {
        await updateDiaryEntry(db, editId, draft);
      } else {
        await saveDiaryEntry(db, draft);
      }
      // Leave via the savedOk effect (not directly): the exit guard must first
      // re-render as clean, or it would challenge our own post-save back.
      setSavedOk(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View
        style={styles.dots}
        accessibilityRole="progressbar"
        accessibilityLabel={t('diary.progress', { current: step + 1, total: steps.length })}
      >
        <Text style={[styles.progress, { color: theme.subtle }, theme.font.body]}>
          {t('diary.progress', { current: step + 1, total: steps.length })}
        </Text>
      </View>
      <Text style={[styles.title, { color: theme.text }, theme.font.heading]}>
        {t(key === 'meaning' && meaningIndex > 0 ? 'diary.steps.meaning.deeperTitle' : `diary.steps.${key}.title`)}
      </Text>
      <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
        {t(`diary.steps.${key}.hint`)}
      </Text>

      <View style={styles.fields}>
        {key === 'situation' && (
          <>
            <Field value={situation} onChange={setSituation} placeholder={t('diary.steps.situation.placeholder')} theme={theme} />
            <View style={styles.moodWrap}>
              <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
                {t('diary.fields.moodBefore')}
              </Text>
              <MoodScale selected={moodBefore} onPick={setMoodBefore} variant="grid" />
            </View>
          </>
        )}
        {key === 'thoughts' && (
          <>
            <Field value={thoughts} onChange={setThoughts} placeholder={t('diary.steps.thoughts.placeholder')} theme={theme} />
            <DistortionPicker selected={distortions} onChange={setDistortions} theme={theme} />
          </>
        )}
        {key === 'emotions' && (
          <EmotionsEditor emotions={emotions} onChange={setEmotions} name={emotionName}
            onNameChange={(value) => { setEmotionName(value); setEmotionError(false); }}
            intensity={emotionIntensity} onIntensityChange={(value) => { setEmotionIntensity(value); setEmotionError(false); }}
            error={emotionError} onAdd={() => {
              if (!emotionName.trim() && !emotionIntensity.trim()) setEmotionError(true);
              else commitEmotion();
            }} theme={theme} />
        )}
        {key === 'belief' && (
          <>
            <Recall value={thoughts} label={t('diary.evidence.thoughtRecall')} theme={theme} />
            <RatingField value={thoughtBelief} onChange={(value) => { setThoughtBelief(value); setBeliefError(false); }}
              label={t('diary.steps.belief.title')} unit="%" error={beliefError} theme={theme} />
          </>
        )}
        {key === 'meaning' && (
          <>
            <Recall value={meaningIndex === 0 ? thoughts : meanings[meaningIndex - 1]}
              label={t(meaningIndex === 0 ? 'diary.evidence.thoughtRecall' : 'diary.meaning.previous')} theme={theme} />
            <Field value={meanings[meaningIndex]} onChange={(value) => setMeanings(meanings.map((answer, index) => index === meaningIndex ? value : answer))}
              placeholder={t(meaningIndex === 0 ? 'diary.steps.meaning.placeholder' : 'diary.steps.meaning.deeperPlaceholder')} theme={theme} />
            {meaningIndex === meanings.length - 1 && meanings[meaningIndex].trim() ? (
              <Pressable accessibilityRole="button" onPress={() => { setMeanings([...meanings, '']); setStep(step + 1); }} style={styles.deepen}>
                <Text style={[{ color: theme.primary }, theme.font.bodySemiBold]}>{t('diary.meaning.deepen')}</Text>
              </Pressable>
            ) : null}
          </>
        )}
        {key === 'coreBelief' && (
          <>
            <Recall value={[...meanings].reverse().find((answer) => answer.trim()) ?? thoughts} label={t('diary.meaning.previous')} theme={theme} />
            <Field value={coreBelief} onChange={setCoreBelief} placeholder={t('diary.steps.coreBelief.placeholder')} theme={theme} />
          </>
        )}
        {key === 'reaction' && (
          <>
            <Field label={t('diary.reaction.body')} value={reactionBody} onChange={setReactionBody} placeholder={t('diary.reaction.bodyPlaceholder')} theme={theme} />
            <Field label={t('diary.reaction.behavior')} value={reactionBehavior} onChange={setReactionBehavior} placeholder={t('diary.reaction.behaviorPlaceholder')} theme={theme} />
          </>
        )}
        {key === 'evidence' && (
          <>
            {/* Echo the thought being weighed, so "за/против" has a clear target
                (user feedback: "в доводах нет того, что я выбрал в мыслях"). */}
            <View style={[styles.thoughtRecall, { borderColor: theme.separator }]}>
              <Text style={[styles.thoughtRecallLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
                {t('diary.evidence.thoughtRecall')}
              </Text>
              <Text style={[styles.thoughtRecallText, { color: theme.text }, theme.font.body]}>
                {thoughts.trim().length > 0 ? thoughts : t('diary.evidence.thoughtRecallEmpty')}
              </Text>
              {distortions.length > 0 ? (
                <Text style={[styles.thoughtRecallTags, { color: theme.subtle }, theme.font.body]}>
                  {distortions.map((k) => t(`diary.distortions.${k}`)).join(' · ')}
                </Text>
              ) : null}
            </View>
            <Field label={t('diary.evidence.for')} value={evidenceFor} onChange={setEvidenceFor} placeholder={t('diary.evidence.forPlaceholder')} theme={theme} />
            <Field label={t('diary.evidence.against')} value={evidenceAgainst} onChange={setEvidenceAgainst} placeholder={t('diary.evidence.againstPlaceholder')} theme={theme} />
          </>
        )}
        {key === 'reframe' && (
          <>
            <Field value={reframe} onChange={setReframe} placeholder={t('diary.reframePlaceholder')} theme={theme} />
            <View style={styles.moodWrap}>
              <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
                {t('diary.fields.moodAfter')}
              </Text>
              <MoodScale selected={mood} onPick={setMood} variant="grid" />
            </View>
          </>
        )}
      </View>

      <View style={styles.nav}>
        {step > 0 ? (
          <Pressable
            onPress={() => setStep(step - 1)}
            style={({ pressed }) => [styles.navBtn, styles.navBack, { borderColor: theme.separator, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.navBackText, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('diary.back')}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.navBtn} />
        )}
        {isLast ? (
          <PrimaryButton
            label={saving ? t('diary.saving') : editId != null ? t('diary.update') : t('diary.save')}
            onPress={onSave}
            disabled={!canSave || saving}
            style={styles.navBtn}
          />
        ) : (
          <PrimaryButton label={t('diary.next')} onPress={onNext} disabled={saving} style={styles.navBtn} />
        )}
      </View>

      {saveError ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: theme.accent }, theme.font.body]}>{t('diary.saveError')}</Text> : null}

      {/* Escape hatch: once there's something worth keeping, let the record be
          saved from any step — no need to tap "Дальше" through to the end. */}
      {!isLast && canSave ? (
        <Pressable onPress={onSave} disabled={saving} hitSlop={8} style={styles.saveExit}>
          <Text style={[styles.saveExitText, { color: theme.subtle }, theme.font.bodyMedium]}>
            {saving ? t('diary.saving') : t('diary.saveExit')}
          </Text>
        </Pressable>
      ) : null}

      {db == null ? (
        <Text style={[styles.dbHint, { color: theme.subtle }, theme.font.body]}>{t('diary.dbUnavailable')}</Text>
      ) : null}
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  theme,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      {label ? (
        <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.bodyMedium]}>{label}</Text>
      ) : null}
      <TextField value={value} onChangeText={onChange} placeholder={placeholder} multiline />
    </View>
  );
}

function Recall({ value, label, theme }: { value: string; label: string; theme: Theme }) {
  if (!value.trim()) return null;
  return (
    <View style={[styles.thoughtRecall, { borderColor: theme.separator }]}>
      <Text style={[styles.thoughtRecallLabel, { color: theme.subtle }, theme.font.bodyMedium]}>{label}</Text>
      <Text style={[styles.thoughtRecallText, { color: theme.text }, theme.font.body]}>{value}</Text>
    </View>
  );
}

function RatingField({ value, onChange, label, unit, error, theme }: {
  value: string; onChange: (value: string) => void; label: string;
  unit: string; error: boolean; theme: Theme;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.bodyMedium]}>{label}</Text>
      <View style={styles.ratingRow}>
        <TextField value={value} onChangeText={onChange} keyboardType="number-pad" inputMode="numeric"
          accessibilityLabel={label} placeholder="0–100" style={styles.ratingInput} />
        <Text style={[{ color: theme.text }, theme.font.body]}>{unit}</Text>
      </View>
      <Text style={[styles.ratingHint, { color: error ? theme.accent : theme.subtle }, theme.font.body]}
        accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite">
        {t('diary.ratingRange')}
      </Text>
    </View>
  );
}

function EmotionsEditor({ emotions, onChange, name, onNameChange, intensity, onIntensityChange, error, onAdd, theme }: {
  emotions: Emotion[]; onChange: (emotions: Emotion[]) => void;
  name: string; onNameChange: (name: string) => void;
  intensity: string; onIntensityChange: (intensity: string) => void;
  error: boolean; onAdd: () => void; theme: Theme;
}) {
  const { t } = useTranslation();
  return (
    <View>
      {emotions.map((emotion, index) => (
        <View key={index} style={[styles.emotionChip, { borderColor: theme.separator }]}>
          <Text style={[styles.emotionText, { color: theme.text }, theme.font.bodyMedium]}>
            {emotion.name} · {emotion.intensity}/100
          </Text>
          <Pressable onPress={() => onChange(emotions.filter((_, i) => i !== index))}
            style={styles.emotionRemoveButton} accessibilityRole="button"
            accessibilityLabel={t('diary.emotion.remove', { name: emotion.name })}>
            <Text style={[styles.emotionRemove, { color: theme.subtle }]}>✕</Text>
          </Pressable>
        </View>
      ))}
      <TextField value={name} onChangeText={onNameChange} placeholder={t('diary.emotion.name')}
        accessibilityLabel={t('diary.emotion.name')} />
      {error && !name.trim() ? <Text accessibilityRole="alert" style={[styles.fieldError, { color: theme.accent }, theme.font.body]}>{t('diary.emotion.nameRequired')}</Text> : null}
      <View style={styles.intensityLabel}>
        <RatingField value={intensity} onChange={onIntensityChange} label={t('diary.emotion.intensityLabel')}
          unit="/100" error={error && parseDiaryRating(intensity) == null} theme={theme} />
      </View>
      <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={t('diary.emotion.add')}
        style={({ pressed }) => [styles.emotionAdd, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}>
        <Text style={[styles.emotionAddText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('diary.emotion.add')}</Text>
      </Pressable>
    </View>
  );
}

function DistortionPicker({
  selected,
  onChange,
  theme,
}: {
  selected: DistortionKey[];
  onChange: (d: DistortionKey[]) => void;
  theme: Theme;
}) {
  const { t } = useTranslation();
  // Optional clinical layer — collapsed by default so the 11 labels don't wall
  // off the thought step. Opens automatically when editing a record that has tags.
  const [expanded, setExpanded] = useState(selected.length > 0);
  function toggle(key: DistortionKey) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }
  return (
    <View style={styles.distortWrap}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={styles.distortHead} accessibilityRole="button">
        <Text style={[styles.fieldLabel, styles.distortLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
          {t('diary.distortions.label')}
        </Text>
        <Text style={[styles.distortChevron, { color: theme.subtle }]}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {!expanded && selected.length > 0 ? (
        <Text style={[styles.distortSummary, { color: theme.primary }, theme.font.bodyMedium]}>
          {selected.map((k) => t(`diary.distortions.${k}`)).join(' · ')}
        </Text>
      ) : null}
      {expanded ? (
        <View style={styles.distortRow}>
          {DISTORTION_KEYS.map((key) => {
            const on = selected.includes(key);
            return (
              <Pressable
                key={key}
                onPress={() => toggle(key)}
                style={[styles.distortChip, { borderColor: on ? theme.primary : theme.separator, backgroundColor: on ? theme.iconBg : theme.card }]}
              >
                <Text style={[{ color: on ? theme.primary : theme.text, fontSize: 13 }, theme.font.bodyMedium]}>
                  {t(`diary.distortions.${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { marginTop: 4, marginBottom: 8 },
  progress: { fontSize: 12, lineHeight: 17 },
  title: { fontSize: 22, letterSpacing: -0.4, marginTop: 6 },
  hint: { fontSize: 13, marginTop: 6, marginBottom: 4, lineHeight: 19 },
  fields: { marginVertical: 24 },
  field: { marginBottom: 18 },
  fieldLabel: { fontSize: 14, marginBottom: 8 },
  fieldError: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ratingInput: { flex: 1, maxWidth: 160 },
  ratingHint: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  deepen: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingVertical: 12 },
  nav: { flexDirection: 'row', gap: 12, marginTop: 4 },
  navBtn: { flex: 1 },
  navBack: { borderWidth: 1.5, borderRadius: 6, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  navBackText: { fontSize: 16 },
  saveExit: { alignSelf: 'center', paddingVertical: 12, marginTop: 4 },
  saveExitText: { fontSize: 14 },
  dbHint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  emotionChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    marginBottom: 12,
  },
  emotionText: { fontSize: 14, flex: 1, flexShrink: 1 },
  emotionRemoveButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  emotionRemove: { fontSize: 14 },
  intensityLabel: { marginTop: 12 },
  emotionAdd: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  emotionAddText: { fontSize: 14 },
  moodWrap: { marginTop: 12 },
  thoughtRecall: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 18, marginBottom: 18 },
  thoughtRecallLabel: { fontSize: 12, marginBottom: 6 },
  thoughtRecallText: { fontSize: 15, lineHeight: 21 },
  thoughtRecallTags: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  distortWrap: { marginTop: 16 },
  distortHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  distortLabel: { marginBottom: 0 },
  distortChevron: { fontSize: 13 },
  distortSummary: { fontSize: 13, marginTop: 6 },
  distortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  distortChip: { borderWidth: 1.5, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8 },
});
