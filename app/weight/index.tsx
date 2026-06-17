import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { WeightRow } from '@/lib/core/db/schema';
import { listWeights, upsertWeight } from '@/lib/core/db/weight';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';
import { useTheme } from '@/lib/theme/theme';

/// Log today's weight (one row per day) and reread the trend. Deliberately
/// low-pressure: optional, no daily nag, and the trend is stated neutrally.
export default function WeightScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<WeightRow[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listWeights(db, 30);
        if (active) setItems(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onSave() {
    const kg = toNumber(text);
    if (!db || kg <= 0) return;
    setSaving(true);
    try {
      await upsertWeight(db, new Date(), kg);
      setText('');
      setItems(await listWeights(db, 30));
    } finally {
      setSaving(false);
    }
  }

  const points: WeightPoint[] = (items ?? []).map((w) => ({ date: w.date, weightKg: w.weightKg }));
  const trend = summarizeWeightTrend(points);
  const trendLine = (() => {
    if (!trend) return null;
    const abs = Math.abs(trend.deltaKg).toFixed(1);
    const days = trend.spanDays;
    if (trend.direction === 'steady') return t('weight.trend.steady', { days, abs });
    if (trend.direction === 'down') return t('weight.trend.down', { days, abs });
    return t('weight.trend.up', { days, abs });
  })();

  const valid = toNumber(text) > 0;

  const rows: RowSpec[] = (items ?? []).map((w) => ({
    key: w.date,
    title: formatDay(w.date),
    right: (
      <Text style={[styles.rowKg, { color: theme.text }, theme.font.bodySemiBold]}>
        {w.weightKg.toFixed(1)} {t('weight.unit')}
      </Text>
    ),
  }));

  return (
    <Screen>
      <View style={styles.inputRow}>
        <TextField
          value={text}
          onChangeText={setText}
          placeholder={t('weight.placeholder')}
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('weight.unit')}</Text>
      </View>
      <PrimaryButton
        label={saving ? t('weight.saving') : t('weight.save')}
        onPress={onSave}
        disabled={db == null || !valid || saving}
        style={styles.save}
      />

      {trendLine ? (
        <Card style={styles.trendCard}>
          <Text style={[styles.trendText, { color: theme.text }, theme.font.bodySemiBold]}>{trendLine}</Text>
          <Text style={[styles.trendNote, { color: theme.subtle }, theme.font.body]}>{t('weight.note')}</Text>
        </Card>
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('weight.empty')}</Text>
      ) : (
        <View style={styles.history}>
          <ListGroup rows={rows} />
        </View>
      )}
    </Screen>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/// '2026-06-17' → '17.06.2026'.
function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 12 },
  input: { flex: 1 },
  unit: { fontSize: 15 },
  save: { marginBottom: 16 },
  trendCard: { marginBottom: 16 },
  trendText: { fontSize: 15 },
  trendNote: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  history: { marginTop: 4 },
  rowKg: { fontSize: 16 },
});
