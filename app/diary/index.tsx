import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  listDiaryEntries,
  listDistortionTagsSince,
  type DiaryEntryView,
} from '@/lib/core/db/diary';
import { thinkingTrapOfWeek, type ThinkingTrap } from '@/lib/core/insights/distortions';
import { buildDiaryExport } from '@/lib/core/insights/diaryExport';
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
  const [trap, setTrap] = useState<ThinkingTrap | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const [list, tagLists] = await Promise.all([
          listDiaryEntries(db),
          listDistortionTagsSince(db, weekAgo),
        ]);
        if (!active) return;
        setEntries(list);
        setTrap(thinkingTrapOfWeek(tagLists));
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onShare() {
    if (!entries || entries.length === 0) return;
    const text = buildDiaryExport(entries, {
      title: t('diary.export.title'),
      situation: t('diary.steps.situation.title'),
      thoughts: t('diary.steps.thoughts.title'),
      distortions: t('diary.distortions.label'),
      emotions: t('diary.steps.emotions.title'),
      reaction: t('diary.steps.reaction.title'),
      evidenceFor: t('diary.evidence.for'),
      evidenceAgainst: t('diary.evidence.against'),
      reframe: t('diary.steps.reframe.title'),
      mood: t('diary.moodShort'),
      empty: t('diary.empty'),
      formatDate,
      distortionName: (k) => t(`diary.distortions.${k}`),
    });
    await Share.share({ message: text });
  }

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

      {entries && entries.length > 0 ? (
        <Pressable
          onPress={onShare}
          style={({ pressed }) => [
            styles.shareBtn,
            { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.shareText, { color: theme.primary }]}>{t('diary.export.button')}</Text>
        </Pressable>
      ) : null}

      {trap ? (
        <View style={[styles.trapCard, { backgroundColor: theme.iconBg, borderColor: theme.border }]}>
          <Text style={[styles.trapTitle, { color: theme.text }]}>{t('diary.trap.title')}</Text>
          <Text style={[styles.trapBody, { color: theme.subtle }]}>
            {t('diary.trap.body', {
              name: t(`diary.distortions.${trap.key}`),
              count: trap.count,
            })}
          </Text>
        </View>
      ) : null}

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
  shareBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  shareText: { fontSize: 15, fontWeight: '600' },
  trapCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  trapTitle: { fontSize: 14, fontWeight: '600' },
  trapBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
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
