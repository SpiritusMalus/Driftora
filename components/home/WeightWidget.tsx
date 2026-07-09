import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import type { AppSettings } from '@/lib/core/db/schema';
import { upsertWeight } from '@/lib/core/db/weight';
import { suggestPlan, type GoalMode } from '@/lib/core/insights/bodyMetrics';
import { useTheme } from '@/lib/theme/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

function toNumber(v: string): number {
  const n = Number(v.replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/// Home widget: log today's weight inline (no need to open the full screen) and
/// peek the day's КБЖУ plan in a collapsible below — the plan follows the latest
/// weight. The header row still opens the full «Вес» screen (trend, history,
/// profile). `onSaved` refreshes Home after a save.
export function WeightWidget({
  db,
  latestKg,
  subtitle,
  settings,
  onSaved,
}: {
  db: Db;
  latestKg: number;
  subtitle: string;
  settings: AppSettings | null;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const kg = toNumber(text);
  const valid = kg > 0;

  async function save() {
    if (!db || !valid || saving) return;
    setSaving(true);
    try {
      await upsertWeight(db, new Date(), kg);
      setText('');
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  // Plan preview from the latest weight — same engine as the «Вес» screen.
  const plan =
    settings != null && latestKg > 0
      ? suggestPlan(
          {
            sex: settings.sex,
            birthYear: settings.birthYear,
            heightCm: settings.heightCm,
            activityLevel: settings.activityLevel,
            bodyFatPct: settings.bodyFatPct,
          },
          latestKg,
          (settings.goalMode as GoalMode) ?? 'maintain',
          new Date(),
          settings.goalWeightKg,
        )
      : null;

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => router.push('/weight')} style={styles.head} hitSlop={4}>
        <Ionicons name="scale-outline" size={18} color={theme.accent} />
        <View style={styles.headText}>
          <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('home.feeders.weight')}</Text>
          <Text style={[styles.subtitle, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.tertiary} />
      </Pressable>

      <View style={styles.inputRow}>
        <TextField
          value={text}
          onChangeText={setText}
          keyboardType="numeric"
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

      <Pressable onPress={() => setPlanOpen((v) => !v)} style={styles.planToggle} hitSlop={6}>
        <Text style={[styles.planToggleText, { color: theme.primary }, theme.font.bodySemiBold]}>
          {t('home.weight.planToggle')}
        </Text>
        <Ionicons name={planOpen ? 'chevron-up' : 'chevron-down'} size={14} color={theme.primary} />
      </Pressable>

      {planOpen ? (
        plan != null ? (
          <View style={styles.plan}>
            <Text style={[styles.planKcal, { color: theme.text }, theme.font.body]}>
              {t('home.weight.planKcal', { kcal: plan.kcal })}
            </Text>
            <Text style={[styles.planMacroLine, { color: theme.subtle }, theme.font.body]}>
              {t('macros.protein')} {plan.prot} · {t('macros.fat')} {plan.fat} · {t('macros.carbs')} {plan.carb} {t('units.g')}
            </Text>
            <Text style={[styles.planHint, { color: theme.subtle }, theme.font.body]}>
              {t('home.weight.planHint')}
            </Text>
          </View>
        ) : (
          <Text style={[styles.planHint, { color: theme.subtle }, theme.font.body]}>
            {t('home.weight.planNeedProfile')}
          </Text>
        )
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 13, marginTop: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input: { flex: 1 },
  unit: { fontSize: 14 },
  saveBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  saveText: { fontSize: 14 },
  planToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 12 },
  planToggleText: { fontSize: 13 },
  plan: { marginTop: 10, gap: 6 },
  planKcal: { fontSize: 14 },
  planMacroLine: { fontSize: 13 },
  planHint: { fontSize: 12, lineHeight: 17, marginTop: 4 },
});
