import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { getDiaryEntry, type DiaryEntryView } from '@/lib/core/db/diary';
import { colors, type ThemeColors } from '@/lib/theme/colors';

/// Read-only view of one thought record (reread support for M3).
export default function DiaryEntryScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const db = useDatabase();
  const { id } = useLocalSearchParams<{ id: string }>();
  // undefined = still loading, null = not found.
  const [entry, setEntry] = useState<DiaryEntryView | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const e = await getDiaryEntry(db, Number(id));
        if (active) setEntry(e);
      })();
      return () => {
        active = false;
      };
    }, [db, id]),
  );

  if (db == null) return <Centered theme={theme} text={t('diary.dbUnavailable')} />;
  if (entry === undefined) return <View style={{ flex: 1, backgroundColor: theme.background }} />;
  if (entry === null) return <Centered theme={theme} text={t('diary.notFound')} />;

  const dash = t('diary.emptyValue');
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Section label={t('diary.steps.situation.title')} value={entry.situation} dash={dash} theme={theme} />
      <Section label={t('diary.steps.thoughts.title')} value={entry.thoughts} dash={dash} theme={theme} />
      {entry.distortions.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.subtle }]}>{t('diary.distortions.label')}</Text>
          <Text style={[styles.value, { color: theme.text }]}>
            {entry.distortions.map((k) => t(`diary.distortions.${k}`)).join(' · ')}
          </Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.subtle }]}>{t('diary.steps.emotions.title')}</Text>
        {entry.emotions.length === 0 ? (
          <Text style={[styles.value, { color: theme.text }]}>{dash}</Text>
        ) : (
          entry.emotions.map((em, i) => (
            <Text key={i} style={[styles.value, { color: theme.text }]}>
              • {em.name} — {em.intensity}/100
            </Text>
          ))
        )}
      </View>

      <Section label={t('diary.reaction.body')} value={entry.reactionBody} dash={dash} theme={theme} />
      <Section label={t('diary.reaction.behavior')} value={entry.reactionBehavior} dash={dash} theme={theme} />
      <Section label={t('diary.evidence.for')} value={entry.evidenceFor} dash={dash} theme={theme} />
      <Section label={t('diary.evidence.against')} value={entry.evidenceAgainst} dash={dash} theme={theme} />
      <Section label={t('diary.steps.reframe.title')} value={entry.reframe} dash={dash} theme={theme} />
      <Section
        label={t('diary.fields.mood')}
        value={entry.mood != null ? `${entry.mood}/10` : ''}
        dash={dash}
        theme={theme}
      />
    </ScrollView>
  );
}

function Section({
  label,
  value,
  dash,
  theme,
}: {
  label: string;
  value: string;
  dash: string;
  theme: ThemeColors;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.label, { color: theme.subtle }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.text }]}>
        {value.trim().length > 0 ? value : dash}
      </Text>
    </View>
  );
}

function Centered({ theme, text }: { theme: ThemeColors; text: string }) {
  return (
    <View style={[styles.centered, { backgroundColor: theme.background }]}>
      <Text style={{ color: theme.subtle }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  section: { marginBottom: 16 },
  label: { fontSize: 12, marginBottom: 4 },
  value: { fontSize: 15, lineHeight: 21 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
