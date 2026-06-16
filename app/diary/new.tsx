import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { saveDiaryEntry, type Emotion } from '@/lib/core/db/diary';
import { colors, type ThemeColors } from '@/lib/theme/colors';

/// The СМЭР thought record, one gentle step at a time:
/// Situation → Thoughts → Emotions → Reaction → Evidence → Balanced reframe.
const STEPS = [
  'situation',
  'thoughts',
  'emotions',
  'reaction',
  'evidence',
  'reframe',
] as const;

export default function DiaryNewScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
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
  const [saving, setSaving] = useState(false);

  const key = STEPS[step];
  const isLast = step === STEPS.length - 1;
  // Don't force every field, but avoid saving an entirely empty record.
  const canSave =
    db != null &&
    (situation.trim().length > 0 ||
      thoughts.trim().length > 0 ||
      reframe.trim().length > 0);

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
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.progress, { color: theme.subtle }]}>
        {t('diary.progress', { current: step + 1, total: STEPS.length })}
      </Text>
      <Text style={[styles.title, { color: theme.text }]}>
        {t(`diary.steps.${key}.title`)}
      </Text>
      <Text style={[styles.hint, { color: theme.subtle }]}>
        {t(`diary.steps.${key}.hint`)}
      </Text>

      <View style={styles.fields}>
        {key === 'situation' && (
          <Field
            value={situation}
            onChange={setSituation}
            placeholder={t('diary.steps.situation.placeholder')}
            theme={theme}
          />
        )}
        {key === 'thoughts' && (
          <Field
            value={thoughts}
            onChange={setThoughts}
            placeholder={t('diary.steps.thoughts.placeholder')}
            theme={theme}
          />
        )}
        {key === 'emotions' && (
          <EmotionsEditor emotions={emotions} onChange={setEmotions} theme={theme} />
        )}
        {key === 'reaction' && (
          <>
            <Field
              label={t('diary.reaction.body')}
              value={reactionBody}
              onChange={setReactionBody}
              placeholder={t('diary.reaction.bodyPlaceholder')}
              theme={theme}
            />
            <Field
              label={t('diary.reaction.behavior')}
              value={reactionBehavior}
              onChange={setReactionBehavior}
              placeholder={t('diary.reaction.behaviorPlaceholder')}
              theme={theme}
            />
          </>
        )}
        {key === 'evidence' && (
          <>
            <Field
              label={t('diary.evidence.for')}
              value={evidenceFor}
              onChange={setEvidenceFor}
              placeholder={t('diary.evidence.forPlaceholder')}
              theme={theme}
            />
            <Field
              label={t('diary.evidence.against')}
              value={evidenceAgainst}
              onChange={setEvidenceAgainst}
              placeholder={t('diary.evidence.againstPlaceholder')}
              theme={theme}
            />
          </>
        )}
        {key === 'reframe' && (
          <>
            <Field
              value={reframe}
              onChange={setReframe}
              placeholder={t('diary.reframePlaceholder')}
              theme={theme}
            />
            <MoodPicker
              value={mood}
              onChange={setMood}
              label={t('diary.fields.mood')}
              theme={theme}
            />
          </>
        )}
      </View>

      <View style={styles.nav}>
        {step > 0 ? (
          <Pressable
            onPress={() => setStep(step - 1)}
            style={({ pressed }) => [
              styles.navBtn,
              styles.navBack,
              { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.navBackText, { color: theme.text }]}>{t('diary.back')}</Text>
          </Pressable>
        ) : (
          <View style={styles.navBtn} />
        )}
        {isLast ? (
          <Pressable
            onPress={onSave}
            disabled={!canSave || saving}
            style={({ pressed }) => [
              styles.navBtn,
              { backgroundColor: theme.primary, opacity: !canSave || saving ? 0.4 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.navPrimaryText}>{saving ? t('diary.saving') : t('diary.save')}</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setStep(step + 1)}
            style={({ pressed }) => [
              styles.navBtn,
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={styles.navPrimaryText}>{t('diary.next')}</Text>
          </Pressable>
        )}
      </View>

      {db == null ? (
        <Text style={[styles.dbHint, { color: theme.subtle }]}>{t('diary.dbUnavailable')}</Text>
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
  theme: ThemeColors;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={[styles.fieldLabel, { color: theme.subtle }]}>{label}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.subtle}
        multiline
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
        ]}
      />
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
  theme: ThemeColors;
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
        <View
          key={i}
          style={[styles.emotionChip, { backgroundColor: theme.iconBg, borderColor: theme.border }]}
        >
          <Text style={[styles.emotionText, { color: theme.text }]}>
            {e.name} · {e.intensity}
          </Text>
          <Pressable onPress={() => onChange(emotions.filter((_, idx) => idx !== i))} hitSlop={8}>
            <Text style={[styles.emotionRemove, { color: theme.subtle }]}>✕</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.emotionAddRow}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('diary.emotion.name')}
          placeholderTextColor={theme.subtle}
          style={[styles.emotionName, { color: theme.text, backgroundColor: theme.card, borderColor: theme.border }]}
        />
        <TextInput
          value={intensity}
          onChangeText={setIntensity}
          keyboardType="numeric"
          style={[styles.emotionIntensity, { color: theme.text, backgroundColor: theme.card, borderColor: theme.border }]}
        />
        <Pressable
          onPress={add}
          style={({ pressed }) => [styles.emotionAdd, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.emotionAddText, { color: theme.primary }]}>{t('diary.emotion.add')}</Text>
        </Pressable>
      </View>
      <Text style={[styles.scaleHint, { color: theme.subtle }]}>{t('diary.emotion.scale')}</Text>
    </View>
  );
}

function MoodPicker({
  value,
  onChange,
  label,
  theme,
}: {
  value: number | null;
  onChange: (n: number) => void;
  label: string;
  theme: ThemeColors;
}) {
  return (
    <View style={styles.moodWrap}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }]}>{label}</Text>
      <View style={styles.moodRow}>
        {Array.from({ length: 11 }, (_, n) => {
          const selected = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={[
                styles.moodChip,
                { borderColor: theme.border, backgroundColor: selected ? theme.primary : theme.card },
              ]}
            >
              <Text style={{ color: selected ? '#FFFFFF' : theme.text, fontWeight: '600' }}>{n}</Text>
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
  content: { padding: 16 },
  progress: { fontSize: 12 },
  title: { fontSize: 20, fontWeight: '700', marginTop: 4 },
  hint: { fontSize: 13, marginTop: 4, marginBottom: 4 },
  fields: { marginVertical: 12 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, marginBottom: 4 },
  input: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  nav: { flexDirection: 'row', gap: 12, marginTop: 4 },
  navBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBack: { borderWidth: StyleSheet.hairlineWidth },
  navBackText: { fontSize: 16, fontWeight: '600' },
  navPrimaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  dbHint: { fontSize: 12, textAlign: 'center', marginTop: 12 },
  emotionChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  emotionText: { fontSize: 14 },
  emotionRemove: { fontSize: 14 },
  emotionAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  emotionName: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  emotionIntensity: {
    width: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  emotionAdd: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  emotionAddText: { fontSize: 14, fontWeight: '600' },
  scaleHint: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  moodWrap: { marginTop: 12 },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  moodChip: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
