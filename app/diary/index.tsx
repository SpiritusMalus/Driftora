import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  listDiaryEntries,
  listDistortionTagsSince,
  type DiaryEntryView,
} from '@/lib/core/db/diary';
import { thinkingTrapOfWeek, type ThinkingTrap } from '@/lib/core/insights/distortions';
import { buildDiaryExport } from '@/lib/core/insights/diaryExport';
import { useTheme } from '@/lib/theme/theme';

/// List of thought records, newest first. Tap one to reread it; the button
/// starts a new guided entry.
export default function DiaryListScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
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
    <Screen>
      <PrimaryButton label={t('diary.add')} onPress={() => router.push('/diary/new')} style={styles.add} />

      {entries && entries.length > 0 ? (
        <Pressable
          onPress={onShare}
          style={({ pressed }) => [styles.shareBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[styles.shareText, { color: theme.primary }, theme.font.bodySemiBold]}>
            {t('diary.export.button')}
          </Text>
        </Pressable>
      ) : null}

      {trap ? (
        <Card style={[styles.trapCard, { backgroundColor: theme.iconBg, borderColor: theme.cardBorder }]}>
          <Text style={[styles.trapTitle, { color: theme.text }, theme.font.bodySemiBold]}>
            {t('diary.trap.title')}
          </Text>
          <Text style={[styles.trapBody, { color: theme.subtle }, theme.font.body]}>
            {t('diary.trap.body', { name: t(`diary.distortions.${trap.key}`), count: trap.count })}
          </Text>
        </Card>
      ) : null}

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('diary.dbUnavailable')}</Text>
      ) : entries == null ? null : entries.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('diary.empty')}</Text>
      ) : (
        <View style={styles.list}>
          {entries.map((e) => (
            <Card key={e.id} style={styles.row} onPress={() => router.push(`/diary/${e.id}`)}>
              <Text style={[styles.rowDate, { color: theme.subtle }, theme.font.body]}>{formatDate(e.ts)}</Text>
              <Text style={[styles.rowText, { color: theme.text }, theme.font.body]} numberOfLines={2}>
                {snippet(e, t('diary.emptyValue'))}
              </Text>
              {e.mood != null ? (
                <Text style={[styles.rowMood, { color: theme.subtle }, theme.font.body]}>
                  {t('diary.moodShort')}: {e.mood}/10
                </Text>
              ) : null}
            </Card>
          ))}
        </View>
      )}
    </Screen>
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
  add: { marginTop: 4, marginBottom: 12 },
  shareBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  shareText: { fontSize: 15 },
  trapCard: { marginBottom: 16 },
  trapTitle: { fontSize: 14 },
  trapBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { gap: 10 },
  row: {},
  rowDate: { fontSize: 12, marginBottom: 4 },
  rowText: { fontSize: 15, lineHeight: 21 },
  rowMood: { fontSize: 12, marginTop: 6 },
});
