import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useTheme } from '@/lib/theme/theme';

/// "More" — the app's ONLY full navigation surface (there is no tab bar; Home
/// and Mood reach it through the header «Разделы ›» link). So it earns the same
/// grouped structure as Settings rather than a flat wall of links: three
/// labelled sections — everyday logging, look-back, and meta — mirroring the
/// order the rows already lived in. No new logic, just navigation.
export default function MoreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const coralTile = theme.scheme === 'light' ? '#FBE2D9' : '#3A241B';
  const amberTile = theme.scheme === 'light' ? '#FBEFD9' : '#33261F';
  const neutralTile = theme.scheme === 'light' ? '#EFE6E0' : '#2C2622';

  // Section 1 — the things you log/track every day.
  const daily: RowSpec[] = [
    {
      key: 'food',
      icon: 'restaurant-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('more.sections.food'),
      subtitle: t('more.subtitles.food'),
      onPress: () => router.push('/food'),
    },
    {
      key: 'steps',
      icon: 'walk-outline',
      tint: theme.accent,
      iconBg: amberTile,
      title: t('more.sections.steps'),
      subtitle: t('more.subtitles.steps'),
      onPress: () => router.push('/activity'),
    },
    {
      // Workouts on their OWN screen now («из шагов убрать раздел тренировки»,
      // device feedback 2026-07-12) — no longer a deep-link into the steps screen.
      key: 'workouts',
      icon: 'barbell-outline',
      tint: theme.accent,
      iconBg: amberTile,
      title: t('more.sections.workouts'),
      subtitle: t('more.subtitles.workouts'),
      onPress: () => router.push('/workout'),
    },
    {
      key: 'weight',
      icon: 'scale-outline',
      tint: theme.accent,
      iconBg: amberTile,
      title: t('more.sections.weight'),
      subtitle: t('more.subtitles.weight'),
      onPress: () => router.push('/weight'),
    },
    {
      // The mind side's PLAIN tappable path — on Home it's a left swipe
      // (2026-07-12), and a gesture alone must never be the only door
      // (screen readers, forgotten gestures).
      key: 'mind',
      icon: 'happy-outline',
      tint: theme.primary,
      iconBg: coralTile,
      title: t('more.sections.mind'),
      subtitle: t('more.subtitles.mind'),
      onPress: () => router.push('/mood'),
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

  // Section 3 — help + configuration.
  const app: RowSpec[] = [
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
      <SectionHeader>{t('more.groups.daily')}</SectionHeader>
      <ListGroup rows={daily} />
      <SectionHeader>{t('more.groups.progress')}</SectionHeader>
      <ListGroup rows={progress} />
      <SectionHeader>{t('more.groups.app')}</SectionHeader>
      <ListGroup rows={app} />
    </Screen>
  );
}
