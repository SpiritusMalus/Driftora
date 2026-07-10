import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { setManualSteps } from '@/lib/core/db/steps';
import { useTheme } from '@/lib/theme/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/// Whole non-negative step count from typed input, or -1 for invalid.
function toSteps(v: string): number {
  const n = parseInt(v.replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

/// Home widget: today's ACTIVITY as ONE calm row — steps/workouts in the
/// subtitle, a [+] that unfolds the inline steps input on demand (folded again
/// after a save; a manual entry is sticky — the passive OS sync never
/// overwrites it), and the row itself opening the full «Активность» screen
/// (steps history + Health Connect + the workout log). `onSaved` refreshes
/// Home after a save.
export function StepsWidget({
  db,
  subtitle,
  estimateLine,
  workoutLine,
  onSaved,
}: {
  db: Db;
  subtitle: string;
  /// Optional «сегодня N шагов ≈ M ккал» line — shown only on the value-ladder
  /// rung where a weight is logged but no goal is set yet (see Home). Null hides it.
  estimateLine?: string | null;
  /// Optional «тренировки: +N ккал» line once a workout is logged today — the
  /// widget speaks for the whole activity layer, not steps alone. Null hides it.
  workoutLine?: string | null;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const steps = toSteps(text);
  const valid = steps >= 0 && text.trim().length > 0;

  async function save() {
    if (!db || !valid || saving) return;
    setSaving(true);
    try {
      await setManualSteps(db, new Date(), steps);
      setText('');
      setOpen(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={() => router.push('/activity')} style={styles.headMain} hitSlop={4}>
          <Ionicons name="walk-outline" size={18} color={theme.accent} />
          <View style={styles.headText}>
            <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('home.feeders.steps')}</Text>
            <Text style={[styles.subtitle, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={() => setOpen((v) => !v)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('home.inlineAdd')}
          style={({ pressed }) => [
            styles.plusBtn,
            { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name={open ? 'remove' : 'add'} size={18} color={theme.primary} />
        </Pressable>
        <Pressable onPress={() => router.push('/activity')} hitSlop={8}>
          <Ionicons name="chevron-forward" size={16} color={theme.tertiary} />
        </Pressable>
      </View>

      {open ? (
        <View style={styles.inputRow}>
          <TextField
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
            autoFocus
            placeholder={t('home.steps.placeholder')}
            style={styles.input}
          />
          <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('steps.unit')}</Text>
          <Pressable
            onPress={() => void save()}
            disabled={!valid || saving}
            accessibilityRole="button"
            accessibilityLabel={t('home.weight.save')}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: theme.primary, opacity: !valid || saving ? 0.5 : pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.saveText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
              {saving ? t('home.weight.saving') : t('home.weight.save')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {workoutLine ? (
        <Text style={[styles.estimate, { color: theme.subtle }, theme.font.body]}>{workoutLine}</Text>
      ) : null}
      {estimateLine ? (
        <Text style={[styles.estimate, { color: theme.subtle }, theme.font.body]}>{estimateLine}</Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { flex: 1 },
  plusBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15 },
  subtitle: { fontSize: 13, marginTop: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  estimate: { fontSize: 13, marginTop: 10, lineHeight: 18 },
  input: { flex: 1 },
  unit: { fontSize: 14 },
  saveBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  saveText: { fontSize: 14 },
});
