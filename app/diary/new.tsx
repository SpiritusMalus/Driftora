import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MoodScale } from '@/components/ui/MoodScale';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { saveDiaryEntry, type Emotion } from '@/lib/core/db/diary';
import { DISTORTION_KEYS, type DistortionKey } from '@/lib/core/insights/distortions';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The СМЭР thought record, one gentle step at a time:
/// Situation → Thoughts → Emotions → Reaction → Evidence → Balanced reframe.
const STEPS = ['situation', 'thoughts', 'emotions', 'reaction', 'evidence', 'reframe'] as const;

export default function DiaryNewScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();

  const [step, setStep] = useState(0);
  const [situation, setSituation] = useState('');
  const [thoughts, setThoughts] = useState('');
  const [emotions, setEmotions] = useState<Emotion[]>([]);
  const [reactionBody, setReactionBody] = useState('');
  const [reactionBehavior, setReactionBehavior] = useState('');
  const [evidenceFor, setEvidenceFor] = useState('');
  const [evidenceAgainst, setEvidenceAgainst] = useState('');
  const [reframe, setReframe] = useState('');
  const [mood, setMood] = useState<number | null>(null);
  const [distortions, setDistortions] = useState<DistortionKey[]>([]);
  const [saving, setSaving] = useState(false);

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
      await saveDiaryEntry(db, {
        situation,
        thoughts,
        emotions,
        reactionBody,
        reactionBehavior,
        evidenceFor,
        evidenceAgainst,
        reframe,
        mood,
        distortions,
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={theme.isIOS ? styles.iosContent : styles.androidContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.progress, { color: theme.subtle }, theme.font.heading]}>
        {t('diary.progress', { current: step + 1, total: STEPS.length })}
      </Text>
      <Text style={[styles.title, { color: theme.text }, theme.font.heading]}>
        {t(`diary.steps.${key}.title`)}
      </Text>
      <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
        {t(`diary.steps.${key}.hint`)}
      </Text>

      <View style={styles.fields}>
        {key === 'situation' && (
          <Field value={situation} onChange={setSituation} placeholder={t('diary.steps.situation.placeholder')} theme={theme} />
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
            <Field label={t('diary.evidence.for')} value={evidenceFor} onChange={setEvidenceFor} placeholder={t('diary.evidence.forPlaceholder')} theme={theme} />
            <Field label={t('diary.evidence.against')} value={evidenceAgainst} onChange={setEvidenceAgainst} placeholder={t('diary.evidence.againstPlaceholder')} theme={theme} />
          </>
        )}
        {key === 'reframe' && (
          <>
            <Field value={reframe} onChange={setReframe} placeholder={t('diary.reframePlaceholder')} theme={theme} />
            <View style={styles.moodWrap}>
              <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
                {t('diary.fields.mood')}
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
            label={saving ? t('diary.saving') : t('diary.save')}
            onPress={onSave}
            disabled={!canSave || saving}
            style={styles.navBtn}
          />
        ) : (
          <PrimaryButton label={t('diary.next')} onPress={() => setStep(step + 1)} style={styles.navBtn} />
        )}
      </View>

      {db == null ? (
        <Text style={[styles.dbHint, { color: theme.subtle }, theme.font.body]}>{t('diary.dbUnavailable')}</Text>
      ) : null}
    </ScrollView>
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
  const [intensity, setIntensity] = useState('50');

  function add() {
    const nm = name.trim();
    if (nm.length === 0) return;
    onChange([...emotions, { name: nm, intensity: clamp(toInt(intensity), 0, 100) }]);
    setName('');
    setIntensity('50');
  }

  return (
    <View>
      {emotions.map((e, i) => (
        <View key={i} style={[styles.emotionChip, { backgroundColor: theme.iconBg, borderColor: theme.cardBorder }]}>
          <Text style={[styles.emotionText, { color: theme.text }, theme.font.bodyMedium]}>
            {e.name} · {e.intensity}
          </Text>
          <Pressable onPress={() => onChange(emotions.filter((_, idx) => idx !== i))} hitSlop={8}>
            <Text style={[styles.emotionRemove, { color: theme.subtle }]}>✕</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.emotionAddRow}>
        <TextField value={name} onChangeText={setName} placeholder={t('diary.emotion.name')} style={styles.emotionName} />
        <TextField value={intensity} onChangeText={setIntensity} keyboardType="numeric" style={styles.emotionIntensity} />
        <Pressable onPress={add} style={({ pressed }) => [styles.emotionAdd, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.emotionAddText, { color: theme.primary }, theme.font.bodySemiBold]}>
            {t('diary.emotion.add')}
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.scaleHint, { color: theme.subtle }, theme.font.body]}>{t('diary.emotion.scale')}</Text>
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
  function toggle(key: DistortionKey) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }
  return (
    <View style={styles.distortWrap}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.bodyMedium]}>
        {t('diary.distortions.label')}
      </Text>
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
    </View>
  );
}

function toInt(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const styles = StyleSheet.create({
  androidContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  iosContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  progress: { fontSize: 11, letterSpacing: 1.2 },
  title: { fontSize: 22, letterSpacing: -0.4, marginTop: 6 },
  hint: { fontSize: 13, marginTop: 6, marginBottom: 4, lineHeight: 19 },
  fields: { marginVertical: 12 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, marginBottom: 6 },
  nav: { flexDirection: 'row', gap: 12, marginTop: 4 },
  navBtn: { flex: 1 },
  navBack: { borderWidth: 1.5, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  navBackText: { fontSize: 16 },
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
  emotionAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  emotionName: { flex: 1 },
  emotionIntensity: { width: 64, textAlign: 'center' },
  emotionAdd: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12 },
  emotionAddText: { fontSize: 14 },
  scaleHint: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  moodWrap: { marginTop: 12 },
  distortWrap: { marginTop: 16 },
  distortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  distortChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
});
