import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listMoods, logMood } from '@/lib/core/db/mood';
import type { MoodRow } from '@/lib/core/db/schema';
import { colors } from '@/lib/theme/colors';
import { fonts } from '@/lib/theme/typography';

/// One-tap mood check-in (0–10) — low-friction so it can feed the Body↔Mind
/// insight daily without a full thought record. Tapping a number logs it.
export default function MoodScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const db = useDatabase();

  const [items, setItems] = useState<MoodRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listMoods(db, 30);
        if (active) setItems(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onPick(value: number) {
    if (!db || saving) return;
    setSaving(true);
    try {
      await logMood(db, value);
      setItems(await listMoods(db, 30));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.prompt, { color: theme.text }]}>{t('mood.prompt')}</Text>
      <View style={styles.row}>
        {Array.from({ length: 11 }, (_, n) => (
          <Pressable
            key={n}
            onPress={() => onPick(n)}
            disabled={db == null || saving}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: theme.border, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Text style={{ color: theme.text, fontFamily: fonts.bodySemiBold, fontSize: 15 }}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.scale, { color: theme.subtle }]}>{t('mood.scale')}</Text>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('mood.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('mood.empty')}</Text>
      ) : (
        items.map((m) => (
          <View key={m.id} style={[styles.item, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.itemDate, { color: theme.subtle }]}>{formatDate(m.ts)}</Text>
            <Text style={[styles.itemValue, { color: theme.text }]}>{m.value}/10</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  prompt: { fontFamily: fonts.heading, fontSize: 19, letterSpacing: -0.3, marginBottom: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scale: { fontFamily: fonts.body, fontSize: 12, marginTop: 10, marginBottom: 8 },
  hint: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginTop: 20 },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
  },
  itemDate: { fontFamily: fonts.body, fontSize: 13 },
  itemValue: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
});
