import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
} from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listDiaryEntries, type DiaryEntryView } from '@/lib/core/db/diary';
import { colors } from '@/lib/theme/colors';

/// List of thought records, newest first. Tap one to reread it; the button
/// starts a new guided entry.
export default function DiaryListScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const router = useRouter();
  const db = useDatabase();
  const [entries, setEntries] = useState<DiaryEntryView[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listDiaryEntries(db);
        if (active) setEntries(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Pressable
        onPress={() => router.push('/diary/new')}
        style={({ pressed }) => [
          styles.addBtn,
          { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={styles.addText}>{t('diary.add')}</Text>
      </Pressable>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('diary.dbUnavailable')}</Text>
      ) : entries == null ? null : entries.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('diary.empty')}</Text>
      ) : (
        entries.map((e) => (
          <Pressable
            key={e.id}
            onPress={() => router.push(`/diary/${e.id}`)}
            style={({ pressed }) => [
              styles.row,
              { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Text style={[styles.rowDate, { color: theme.subtle }]}>{formatDate(e.ts)}</Text>
            <Text style={[styles.rowText, { color: theme.text }]} numberOfLines={2}>
              {snippet(e, t('diary.emptyValue'))}
            </Text>
            {e.mood != null ? (
              <Text style={[styles.rowMood, { color: theme.subtle }]}>
                {t('diary.moodShort')}: {e.mood}/10
              </Text>
            ) : null}
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function snippet(e: DiaryEntryView, fallback: string): string {
  const text = (e.situation || e.thoughts || e.reframe || '').trim();
  return text.length > 0 ? text : fallback;
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  addBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  addText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 10,
  },
  rowDate: { fontSize: 12, marginBottom: 4 },
  rowText: { fontSize: 15 },
  rowMood: { fontSize: 12, marginTop: 6 },
});
