import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
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
import type { WeightRow } from '@/lib/core/db/schema';
import { listWeights, upsertWeight } from '@/lib/core/db/weight';
import { summarizeWeightTrend, type WeightPoint } from '@/lib/core/insights/weightTrend';
import { colors } from '@/lib/theme/colors';

/// Log today's weight (one row per day) and reread the trend. Deliberately
/// low-pressure: optional, no daily nag, and the trend is stated neutrally.
export default function WeightScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
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

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('weight.placeholder')}
          placeholderTextColor={theme.subtle}
          keyboardType="decimal-pad"
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.card, borderColor: theme.border },
          ]}
        />
        <Text style={[styles.unit, { color: theme.subtle }]}>{t('weight.unit')}</Text>
      </View>
      <Pressable
        onPress={onSave}
        disabled={db == null || !valid || saving}
        style={({ pressed }) => [
          styles.saveBtn,
          {
            backgroundColor: theme.primary,
            opacity: db == null || !valid || saving ? 0.4 : pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text style={styles.saveText}>{saving ? t('weight.saving') : t('weight.save')}</Text>
      </Pressable>

      {trendLine ? (
        <View style={[styles.trendCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.trendText, { color: theme.text }]}>{trendLine}</Text>
          <Text style={[styles.trendNote, { color: theme.subtle }]}>{t('weight.note')}</Text>
        </View>
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('weight.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('weight.empty')}</Text>
      ) : (
        items.map((w) => (
          <View key={w.date} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.rowDate, { color: theme.subtle }]}>{formatDay(w.date)}</Text>
            <Text style={[styles.rowKg, { color: theme.text }]}>
              {w.weightKg.toFixed(1)} {t('weight.unit')}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
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
  content: { padding: 16 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
  },
  unit: { fontSize: 15 },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  trendCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  trendText: { fontSize: 15, fontWeight: '600' },
  trendNote: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  rowDate: { fontSize: 13 },
  rowKg: { fontSize: 16, fontWeight: '600' },
});
