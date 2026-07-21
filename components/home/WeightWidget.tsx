import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { upsertWeight } from '@/lib/core/db/weight';
import { weightValid } from '@/lib/core/insights/bodySetup';
import { useTheme } from '@/lib/theme/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function toNumber(v: string): number {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/// Home widget: today's weight as ONE calm row — the value in the subtitle, a
/// [+] that unfolds the inline input on demand (folded again after a save), and
/// the row itself opening the full «Вес» screen. The always-open field + big
/// «Сохранить» were part of the «много шума» complaint (2026-07-10).
export function WeightWidget({
  db,
  subtitle,
  onSaved,
}: {
  db: Db;
  subtitle: string;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const kg = toNumber(text);
  // Same bounds as the body-setup wizard — a slipped decimal («9.4» for 94)
  // must not silently poison the trend, BMI and the day plan.
  const valid = weightValid(kg);
  const rangeIssue = text.trim().length > 0 && kg > 0 && !valid;

  async function save() {
    if (!db || !valid || saving) return;
    setSaving(true);
    try {
      await upsertWeight(db, new Date(), kg);
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
        <Pressable onPress={() => router.push('/weight')} style={styles.headMain} hitSlop={4}>
          <Ionicons name="scale-outline" size={18} color={theme.accent} />
          <View style={styles.headText}>
            <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('home.feeders.weight')}</Text>
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
          <Ionicons name={open ? 'remove' : 'add'} size={18} color={theme.icon} />
        </Pressable>
        <Pressable onPress={() => router.push('/weight')} hitSlop={8}>
          <Ionicons name="chevron-forward" size={16} color={theme.tertiary} />
        </Pressable>
      </View>

      {open ? (
        <View style={styles.inputRow}>
          <TextField
            value={text}
            onChangeText={setText}
            keyboardType="numeric"
            autoFocus
            placeholder={t('home.weight.placeholder')}
            style={styles.input}
          />
          <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.unit')}</Text>
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
      {open && rangeIssue ? (
        <Text style={[styles.rangeHint, { color: theme.subtle }, theme.font.body]}>
          {t('weight.rangeHint')}
        </Text>
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
  rangeHint: { fontSize: 12, marginTop: 6 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 13, marginTop: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input: { flex: 1 },
  unit: { fontSize: 14 },
  saveBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  saveText: { fontSize: 14 },
});
