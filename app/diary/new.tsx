import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MoodScale } from '@/components/ui/MoodScale';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { getDiaryEntry, saveDiaryEntry, updateDiaryEntry, type Emotion } from '@/lib/core/db/diary';
import { DISTORTION_KEYS, type DistortionKey } from '@/lib/core/insights/distortions';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The thought record, one gentle step at a time. Order tuned from user feedback
/// (2026-06-25): the automatic stuff first (situation, feeling, reaction), THEN
/// name the thought, then weigh it. Mood is rated before (on `situation`) and
/// after (on `reframe`) so the record shows the shift.
const STEPS = ['situation', 'emotions', 'reaction', 'thoughts', 'evidence', 'reframe'] as const;

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
  const [saving, setSaving] = useState(false);

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
    })();
    return () => {
      active = false;
    };
  }, [db, editId]);

  const key = STEPS[step];
  const isLast = step === STEPS.length - 1;
  // Don't force every field, but avoid saving an entirely empty record.
  const canSave =
    db != null &&
    (situation.trim().length > 0 || thoughts.trim().length > 0 || reframe.trim().length > 0);

  async function onSave() {
    if (!db) return;
    setSaving(true);
    try {
      const draft = {
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
      };
      // Editing preserves the original ts (no ts arg); a new record gets now().
      if (editId != null) {
        await updateDiaryEntry(db, editId, draft);
      } else {
        await saveDiaryEntry(db, draft);
      }
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View
        style={styles.dots}
        accessibilityRole="progressbar"
        accessibilityLabel={t('diary.progress', { current: step + 1, total: STEPS.length })}
      >
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i <= step ? theme.primary : theme.separator },
              i === step && styles.dotActive,
            ]}
          />
        ))}
      </View>
      <Text style={[styles.title, { color: theme.text }, theme.font.heading]}>
        {t(`diary.steps.${key}.title`)}
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
        {key === 'emotions' && <EmotionsEditor emotions={emotions} onChange={setEmotions} theme={theme} />}
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
            <View style={[styles.thoughtRecall, { backgroundColor: theme.iconBg, borderColor: theme.cardBorder }]}>
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
          <PrimaryButton label={t('diary.next')} onPress={() => setStep(step + 1)} style={styles.navBtn} />
        )}
      </View>

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

function EmotionsEditor({
  emotions,
  onChange,
  theme,
}: {
  emotions: Emotion[];
  onChange: (e: Emotion[]) => void;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  // Intensity is picked from four buckets instead of typed — a tap beats the
  // numeric keyboard. Stored value stays 0–100 for compatibility with old records.
  const [intensity, setIntensity] = useState(50);
  const levels: { value: number; label: string }[] = [
    { value: 25, label: t('diary.emotion.low') },
    { value: 50, label: t('diary.emotion.mid') },
    { value: 75, label: t('diary.emotion.high') },
    { value: 100, label: t('diary.emotion.max') },
  ];

  function add() {
    const nm = name.trim();
    if (nm.length === 0) return;
    onChange([...emotions, { name: nm, intensity }]);
    setName('');
    setIntensity(50);
  }

  return (
    <View>
      {emotions.map((e, i) => (
        <View key={i} style={[styles.emotionChip, { backgroundColor: theme.iconBg, borderColor: theme.cardBorder }]}>
          <Text style={[styles.emotionText, { color: theme.text }, theme.font.bodyMedium]}>
            {e.name} · {e.intensity}
          </Text>
          <Pressable
            onPress={() => onChange(emotions.filter((_, idx) => idx !== i))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('diary.emotion.remove', { name: e.name })}
          >
            <Text style={[styles.emotionRemove, { color: theme.subtle }]}>✕</Text>
          </Pressable>
        </View>
      ))}
      <TextField value={name} onChangeText={setName} placeholder={t('diary.emotion.name')} />
      <Text style={[styles.fieldLabel, styles.intensityLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
        {t('diary.emotion.intensityLabel')}
      </Text>
      <View style={styles.intensityChips}>
        {levels.map((lv) => {
          const on = intensity === lv.value;
          return (
            <Pressable
              key={lv.value}
              onPress={() => setIntensity(lv.value)}
              style={[styles.intensityChip, { borderColor: on ? theme.primary : theme.separator, backgroundColor: on ? theme.iconBg : theme.card }]}
            >
              <Text style={[{ color: on ? theme.primary : theme.text, fontSize: 13 }, theme.font.bodyMedium]}>
                {lv.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable onPress={add} style={({ pressed }) => [styles.emotionAdd, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}>
        <Text style={[styles.emotionAddText, { color: theme.primary }, theme.font.bodySemiBold]}>
          {t('diary.emotion.add')}
        </Text>
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
  dots: { flexDirection: 'row', gap: 6, marginTop: 4, marginBottom: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotActive: { width: 20 },
  title: { fontSize: 22, letterSpacing: -0.4, marginTop: 6 },
  hint: { fontSize: 13, marginTop: 6, marginBottom: 4, lineHeight: 19 },
  fields: { marginVertical: 12 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, marginBottom: 6 },
  nav: { flexDirection: 'row', gap: 12, marginTop: 4 },
  navBtn: { flex: 1 },
  navBack: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  navBackText: { fontSize: 16 },
  saveExit: { alignSelf: 'center', paddingVertical: 12, marginTop: 4 },
  saveExitText: { fontSize: 14 },
  dbHint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  emotionChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  emotionText: { fontSize: 14 },
  emotionRemove: { fontSize: 14 },
  intensityLabel: { marginTop: 12 },
  intensityChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  intensityChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  emotionAdd: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  emotionAddText: { fontSize: 14 },
  moodWrap: { marginTop: 12 },
  thoughtRecall: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, marginBottom: 14 },
  thoughtRecallLabel: { fontSize: 12, marginBottom: 6 },
  thoughtRecallText: { fontSize: 15, lineHeight: 21 },
  thoughtRecallTags: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  distortWrap: { marginTop: 16 },
  distortHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  distortLabel: { marginBottom: 0 },
  distortChevron: { fontSize: 13 },
  distortSummary: { fontSize: 13, marginTop: 6 },
  distortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  distortChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
