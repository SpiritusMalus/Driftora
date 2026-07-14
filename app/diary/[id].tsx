import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { deleteDiaryEntry, getDiaryEntry, type DiaryEntryView } from '@/lib/core/db/diary';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Read-only view of one thought record (reread support for M3).
export default function DiaryEntryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const { id } = useLocalSearchParams<{ id: string }>();
  // undefined = still loading, null = not found.
  const [entry, setEntry] = useState<DiaryEntryView | null | undefined>(undefined);

  function onDelete() {
    Alert.alert(t('diary.deleteTitle'), t('diary.deleteConfirm'), [
      { text: t('diary.deleteCancel'), style: 'cancel' },
      {
        text: t('diary.delete'),
        style: 'destructive',
        onPress: () => {
          if (!db) return;
          void (async () => {
            try {
              await deleteDiaryEntry(db, Number(id));
              router.back();
            } catch {
              // Never swallow the failure — if we don't navigate back the screen
              // just sits there and the user has no idea the delete didn't take.
              Alert.alert(t('diary.deleteError'));
            }
          })();
        },
      },
    ]);
  }

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
  // The payoff of a thought record is the mood shift — lead with it when both
  // ratings exist. Situation / thoughts / reframe stay always-on (the CBT
  // skeleton); the rest of the fields only show when the user actually filled
  // them, so a short record isn't a wall of "—".
  const hasShift = entry.moodBefore != null && entry.mood != null;
  return (
    <Screen>
      <Text style={[styles.date, { color: theme.subtle }, theme.font.body]}>{formatDate(entry.ts)}</Text>
      <Card>
        {hasShift ? (
          <View style={[styles.shiftHero, { borderBottomColor: theme.separator }]}>
            <View style={styles.shiftRow}>
              <Text style={[styles.shiftNum, { color: theme.subtle }, theme.font.heading]}>{entry.moodBefore}</Text>
              <Text style={[styles.shiftArrow, { color: theme.subtle }]}>→</Text>
              <Text style={[styles.shiftNum, { color: theme.heroAccent }, theme.font.heading]}>{entry.mood}</Text>
            </View>
            <Text style={[styles.shiftCaption, { color: theme.subtle }, theme.font.body]}>
              {t('diary.moodShiftCaption')}
            </Text>
          </View>
        ) : null}

        <Section label={t('diary.steps.situation.title')} value={entry.situation} dash={dash} theme={theme} first={!hasShift} />

        {entry.emotions.length > 0 ? (
          <Block label={t('diary.steps.emotions.title')} theme={theme}>
            {entry.emotions.map((em, i) => (
              <Text key={i} style={[styles.value, { color: theme.text }, theme.font.body]}>
                • {em.name} — {em.intensity}/100
              </Text>
            ))}
          </Block>
        ) : null}

        {entry.reactionBody.trim().length > 0 ? (
          <Section label={t('diary.reaction.body')} value={entry.reactionBody} dash={dash} theme={theme} />
        ) : null}
        {entry.reactionBehavior.trim().length > 0 ? (
          <Section label={t('diary.reaction.behavior')} value={entry.reactionBehavior} dash={dash} theme={theme} />
        ) : null}

        <Section label={t('diary.steps.thoughts.title')} value={entry.thoughts} dash={dash} theme={theme} />
        {entry.distortions.length > 0 ? (
          <Block label={t('diary.distortions.label')} theme={theme}>
            <Text style={[styles.value, { color: theme.text }, theme.font.body]}>
              {entry.distortions.map((k) => t(`diary.distortions.${k}`)).join(' · ')}
            </Text>
          </Block>
        ) : null}

        {entry.evidenceFor.trim().length > 0 ? (
          <Section label={t('diary.evidence.for')} value={entry.evidenceFor} dash={dash} theme={theme} />
        ) : null}
        {entry.evidenceAgainst.trim().length > 0 ? (
          <Section label={t('diary.evidence.against')} value={entry.evidenceAgainst} dash={dash} theme={theme} />
        ) : null}

        <Section label={t('diary.steps.reframe.title')} value={entry.reframe} dash={dash} theme={theme} />

        {/* Only one mood recorded — no shift to show, so surface it as a plain row. */}
        {!hasShift && entry.moodBefore != null ? (
          <Section label={t('diary.fields.moodBefore')} value={`${entry.moodBefore}/10`} dash={dash} theme={theme} />
        ) : null}
        {!hasShift && entry.mood != null ? (
          <Section label={t('diary.fields.moodAfter')} value={`${entry.mood}/10`} dash={dash} theme={theme} />
        ) : null}
      </Card>

      <PrimaryButton label={t('diary.edit')} onPress={() => router.push(`/diary/new?id=${id}`)} style={styles.edit} />
      <Pressable
        onPress={onDelete}
        style={({ pressed }) => [styles.deleteBtn, { borderColor: theme.separator, opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.deleteText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('diary.delete')}</Text>
      </Pressable>
    </Screen>
  );
}

function Block({ label, theme, children, first }: { label: string; theme: Theme; children: React.ReactNode; first?: boolean }) {
  return (
    <View style={[styles.section, first && styles.sectionFirst]}>
      <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      {children}
    </View>
  );
}

function Section({
  label,
  value,
  dash,
  theme,
  first,
}: {
  label: string;
  value: string;
  dash: string;
  theme: Theme;
  first?: boolean;
}) {
  return (
    <Block label={label} theme={theme} first={first}>
      <Text style={[styles.value, { color: theme.text }, theme.font.body]}>
        {value.trim().length > 0 ? value : dash}
      </Text>
    </Block>
  );
}

function Centered({ theme, text }: { theme: Theme; text: string }) {
  return (
    <View style={[styles.centered, { backgroundColor: theme.background }]}>
      <Text style={[{ color: theme.subtle }, theme.font.body]}>{text}</Text>
    </View>
  );
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  date: { fontSize: 12, marginTop: 4, marginBottom: 12, marginHorizontal: 4 },
  edit: { marginTop: 16 },
  deleteBtn: { borderWidth: 1.5, borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  deleteText: { fontSize: 15 },
  shiftHero: { alignItems: 'center', paddingBottom: 16, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  shiftNum: { fontSize: 40, lineHeight: 44 },
  shiftArrow: { fontSize: 24 },
  shiftCaption: { fontSize: 12, marginTop: 4 },
  section: { marginTop: 16 },
  sectionFirst: { marginTop: 0 },
  label: { fontSize: 12, marginBottom: 4 },
  value: { fontSize: 15, lineHeight: 22 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
