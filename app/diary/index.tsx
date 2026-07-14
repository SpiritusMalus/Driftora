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
import { ensureSettings } from '@/lib/core/db/settings';
import { diaryInsight, type DiarySuggestion } from '@/lib/core/insights/diaryInsight';
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
  // The on-device CBT suggestion (A1), only when the user opted into diary assist.
  const [suggestion, setSuggestion] = useState<DiarySuggestion | null>(null);
  const [assistDismissed, setAssistDismissed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const [list, tagLists, settings] = await Promise.all([
          listDiaryEntries(db),
          listDistortionTagsSince(db, weekAgo),
          ensureSettings(db),
        ]);
        if (!active) return;
        setEntries(list);
        setTrap(thinkingTrapOfWeek(tagLists));
        // On-device only: compute the gentle CBT suggestion from already-stored
        // fields. No network, no LLM — gated by the opt-in flag (default OFF).
        setSuggestion(settings.llmDiaryAssist ? diaryInsight(list) : null);
        setAssistDismissed(false);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  function assistText(s: DiarySuggestion): string {
    switch (s.kind) {
      case 'crisis_support':
        return t('diary.assist.crisis');
      case 'recurring_distortion':
        return t('diary.assist.recurringDistortion', {
          name: t(`diary.distortions.${s.distortion}`),
          count: s.count,
        });
      case 'high_intensity_emotion':
        return t('diary.assist.highIntensity');
      case 'missing_reframe':
        return t('diary.assist.missingReframe');
    }
  }

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
        <Pressable onPress={onShare} hitSlop={8} style={({ pressed }) => [styles.shareBtn, { opacity: pressed ? 0.5 : 1 }]}>
          <Text style={[styles.shareText, { color: theme.primary }, theme.font.bodySemiBold]}>
            {t('diary.export.button')}
          </Text>
        </Pressable>
      ) : null}

      {/* One card above the list, never two: the gentle nudge takes priority
          over the weekly trap so the top of the screen stays calm. */}
      {suggestion && !assistDismissed ? (
        <Card
          style={[
            styles.assistCard,
            {
              backgroundColor: theme.iconBg,
              borderColor: suggestion.kind === 'crisis_support' ? theme.primary : theme.cardBorder,
            },
          ]}
        >
          <View style={styles.assistHead}>
            <Text style={[styles.assistTitle, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('diary.assist.title')}
            </Text>
            <Pressable onPress={() => setAssistDismissed(true)} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.assistDismiss, { color: theme.subtle }, theme.font.body]}>
                {t('diary.assist.dismiss')}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.assistBody, { color: theme.subtle }, theme.font.body]}>
            {assistText(suggestion)}
          </Text>
        </Card>
      ) : null}

      {trap && !(suggestion && !assistDismissed) ? (
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
              <View style={styles.rowHead}>
                <Text style={[styles.rowDate, { color: theme.subtle }, theme.font.body]}>{formatDate(e.ts)}</Text>
                {e.mood != null ? (
                  <Text style={[styles.rowMood, { color: theme.subtle }, theme.font.bodyMedium]}>{e.mood}/10</Text>
                ) : null}
              </View>
              <Text style={[styles.rowText, { color: theme.text }, theme.font.body]} numberOfLines={2}>
                {snippet(e, t('diary.emptyValue'))}
              </Text>
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
  shareBtn: { alignSelf: 'flex-end', paddingVertical: 6, marginBottom: 12 },
  shareText: { fontSize: 14 },
  assistCard: { marginBottom: 16 },
  assistHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assistTitle: { fontSize: 14, flex: 1, paddingRight: 12 },
  assistDismiss: { fontSize: 13 },
  assistBody: { fontSize: 13, marginTop: 4, lineHeight: 19 },
  trapCard: { marginBottom: 16 },
  trapTitle: { fontSize: 14 },
  trapBody: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { gap: 10 },
  row: {},
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowDate: { fontSize: 12 },
  rowText: { fontSize: 15, lineHeight: 21 },
  rowMood: { fontSize: 12 },
});
