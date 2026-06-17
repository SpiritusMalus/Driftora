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
import { DISTORTION_KEYS, type DistortionKey } from '@/lib/core/insights/distortions';
import { colors, type ThemeColors } from '@/lib/theme/colors';
import { fonts } from '@/lib/theme/typography';

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
  const [distortions, setDistortions] = useState<DistortionKey[]>([]);
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
          <>
            <Field
              value={thoughts}
              onChange={setThoughts}
              placeholder={t('diary.steps.thoughts.placeholder')}
              theme={theme}
            />
            <DistortionPicker selected={distortions} onChange={setDistortions} theme={theme} />
          </>
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
            <Text style={[styles.navPrimaryText, { color: theme.onPrimary }]}>
              {saving ? t('diary.saving') : t('diary.save')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => setStep(step + 1)}
            style={({ pressed }) => [
              styles.navBtn,
              { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={[styles.navPrimaryText, { color: theme.onPrimary }]}>{t('diary.next')}</Text>
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
              <Text style={{ color: selected ? theme.onPrimary : theme.text, fontFamily: fonts.bodySemiBold, fontSize: 15 }}>
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  theme: ThemeColors;
}) {
  const { t } = useTranslation();
  function toggle(key: DistortionKey) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }
  return (
    <View style={styles.distortWrap}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }]}>
        {t('diary.distortions.label')}
      </Text>
      <View style={styles.distortRow}>
        {DISTORTION_KEYS.map((key) => {
          const on = selected.includes(key);
          return (
            <Pressable
              key={key}
              onPress={() => toggle(key)}
              style={[
                styles.distortChip,
                { borderColor: on ? theme.primary : theme.border, backgroundColor: on ? theme.iconBg : theme.card },
              ]}
            >
              <Text style={{ color: on ? theme.primary : theme.text, fontSize: 13, fontFamily: fonts.bodyMedium }}>
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
  content: { padding: 16 },
  progress: { fontFamily: fonts.heading, fontSize: 11, letterSpacing: 1.2 },
  title: { fontFamily: fonts.heading, fontSize: 22, letterSpacing: -0.4, marginTop: 6 },
  hint: { fontFamily: fonts.body, fontSize: 13, marginTop: 6, marginBottom: 4, lineHeight: 19 },
  fields: { marginVertical: 12 },
  field: { marginBottom: 12 },
  fieldLabel: { fontFamily: fonts.bodyMedium, fontSize: 12, marginBottom: 6 },
  input: {
    minHeight: 72,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    fontSize: 15,
    fontFamily: fonts.body,
    textAlignVertical: 'top',
  },
  nav: { flexDirection: 'row', gap: 12, marginTop: 4 },
  navBtn: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBack: { borderWidth: 1.5 },
  navBackText: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  navPrimaryText: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  dbHint: { fontFamily: fonts.body, fontSize: 12, textAlign: 'center', marginTop: 12 },
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
  emotionText: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  emotionRemove: { fontSize: 14 },
  emotionAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  emotionName: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.body,
  },
  emotionIntensity: {
    width: 56,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: fonts.body,
    textAlign: 'center',
  },
  emotionAdd: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  emotionAddText: { fontFamily: fonts.bodySemiBold, fontSize: 14 },
  scaleHint: { fontFamily: fonts.body, fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  moodWrap: { marginTop: 12 },
  moodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  moodChip: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distortWrap: { marginTop: 16 },
  distortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  distortChip: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
