import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { MoodScale } from '@/components/ui/MoodScale';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listMoods, logMood } from '@/lib/core/db/mood';
import type { MoodRow } from '@/lib/core/db/schema';
import { useTheme } from '@/lib/theme/theme';

/// One-tap mood check-in (0–10) — low-friction so it can feed the Body↔Mind
/// insight daily without a full thought record. Tapping a number logs it and
/// re-highlights the scale; past check-ins list below as date→value rows.
export default function MoodScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<MoodRow[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listMoods(db, 30);
        if (!active) return;
        setItems(list);
        setSelected(list.length > 0 ? list[0].value : null);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onPick(value: number) {
    if (!db || saving) return;
    setSaving(true);
    setSelected(value);
    try {
      await logMood(db, value);
      setItems(await listMoods(db, 30));
    } finally {
      setSaving(false);
    }
  }

  const historyRows: RowSpec[] = (items ?? []).map((m) => ({
    key: String(m.id),
    title: formatDate(m.ts),
    right: <Text style={[styles.value, { color: theme.text }, theme.font.bodyBold]}>{m.value}/10</Text>,
  }));

  return (
    <Screen>
      <Text style={[styles.prompt, { color: theme.text }, theme.font.bodySemiBold]}>
        {t('mood.prompt')}
      </Text>
      <View style={styles.scaleWrap}>
        <MoodScale selected={selected} onPick={onPick} disabled={db == null || saving} variant="grid" />
      </View>
      <Text style={[styles.scale, { color: theme.subtle }, theme.font.body]}>{t('mood.scale')}</Text>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('mood.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('mood.empty')}</Text>
      ) : (
        <View style={styles.history}>
          <ListGroup rows={historyRows} />
        </View>
      )}
    </Screen>
  );
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  prompt: { fontSize: 17, marginTop: 4 },
  scaleWrap: { marginTop: 14 },
  scale: { fontSize: 12, marginTop: 12, lineHeight: 17 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  history: { marginTop: 16 },
  value: { fontSize: 16 },
});
