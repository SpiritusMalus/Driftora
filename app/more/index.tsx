import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme } from '@/lib/theme/theme';

/// "Разделы" — the app's ONLY full navigation surface (there is no tab bar; Home
/// and Mood reach it through the header «Разделы ›» link).
///
/// ONE rule since 2026-08-22 («не нужно ли хранить только то, чего нет на
/// главном экране»): this list carries what Home does NOT. Еда, шаги,
/// тренировки, вес and настроение each own a Home widget with two tap targets,
/// so a duplicate row here only pushed the truly hidden screens (СМЭР, дни,
/// победы, итоги, план) below the fold. The closing note says out loud where
/// the everyday things live, so the shorter list never reads as "features
/// disappeared".
export default function MoreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const coralTile = theme.primarySoft;
  const amberTile = theme.accentSoft;
  const neutralTile = theme.scheme === 'light' ? '#EFE6E0' : '#2C2622';

  // Section 1 — the two things you WRITE that Home has no room for. СМЭР used
  // to be reachable only from inside the mood screen (swipe + one more tap),
  // which is deep for a record people open mid-anxiety.
  const diaries: RowSpec[] = [
    {
      key: 'diary',
      icon: 'create-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('more.sections.diary'),
      subtitle: t('more.subtitles.diary'),
      onPress: () => router.push('/diary'),
    },
    {
      // The day history — previously behind the «Сегодня ⌄» header title only,
      // i.e. findable by accident. It is the archive of everything logged.
      key: 'days',
      icon: 'calendar-outline',
      tint: theme.accent,
      iconBg: amberTile,
      title: t('more.sections.days'),
      subtitle: t('more.subtitles.days'),
      onPress: () => router.push('/history'),
    },
  ];

  // Section 2 — the look-back screens.
  const progress: RowSpec[] = [
    {
      key: 'wins',
      icon: 'trophy-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('more.sections.wins'),
      subtitle: t('more.subtitles.wins'),
      onPress: () => router.push('/wins'),
    },
    {
      key: 'review',
      icon: 'stats-chart-outline',
      tint: theme.accent,
      iconBg: amberTile,
      title: t('more.sections.review'),
      subtitle: t('more.subtitles.review'),
      onPress: () => router.push('/review'),
    },
  ];

  // Section 3 — configuration + help: touched once a month, never daily.
  const app: RowSpec[] = [
    {
      // Split out of «Веса» (2026-08-22) — goal, tempo, КБЖУ and the body
      // profile are configuration, not a weekly ritual.
      key: 'plan',
      icon: 'flag-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('more.sections.plan'),
      subtitle: t('more.subtitles.plan'),
      onPress: () => router.push('/plan'),
    },
    {
      key: 'how',
      icon: 'help-circle-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('more.sections.how'),
      subtitle: t('more.subtitles.how'),
      onPress: () => router.push('/more/how-it-works'),
    },
    {
      // The paid tier's ONLY navigation entry used to be inside Settings —
      // effectively invisible (owner feedback 2026-08-18). This row is the
      // discoverable door; the screen itself still explains rather than sells.
      key: 'subscription',
      icon: 'sparkles-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('subscription.openRow'),
      subtitle: t('subscription.openRowNote'),
      onPress: () => router.push('/settings/subscription'),
    },
    {
      key: 'settings',
      icon: 'settings-outline',
      tint: theme.isIOS ? '#8E8E93' : theme.subtle,
      iconBg: neutralTile,
      title: t('more.sections.settings'),
      subtitle: t('more.subtitles.settings'),
      onPress: () => router.push('/settings'),
    },
  ];

  return (
    <Screen>
      <SectionHeader>{t('more.groups.diaries')}</SectionHeader>
      <ListGroup rows={diaries} />
      <SectionHeader>{t('more.groups.progress')}</SectionHeader>
      <ListGroup rows={progress} />
      <SectionHeader>{t('more.groups.app')}</SectionHeader>
      <ListGroup rows={app} />
      {/* Plain sentence, not a caps eyebrow: it explains the list's own rule
          («ежедневное — на главной»), so shouting it would read as a heading
          for a group that isn't there. */}
      <Text style={[styles.dailyNote, { color: theme.subtle }, theme.font.body]}>{t('more.dailyNote')}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dailyNote: { fontSize: 13, lineHeight: 18, marginTop: 20, marginHorizontal: 4 },
});
