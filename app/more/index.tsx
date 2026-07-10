import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme/theme';

/// "More" — the home for everything demoted off the daily screen so Home can
/// stay a single insight. A plain list of links to routes that already exist
/// (food log, weight, wins, weekly review, settings). No new logic — just
/// navigation, rendered with the platform-aware grouped list.
export default function MoreScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const coralTile = theme.scheme === 'light' ? '#FBE2D9' : '#3A241B';
  const amberTile = theme.scheme === 'light' ? '#FBEFD9' : '#33261F';
  const neutralTile = theme.scheme === 'light' ? '#EFE6E0' : '#2C2622';

  const rows: RowSpec[] = [
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
      key: 'weight',
      icon: 'scale-outline',
      tint: theme.accent,
      iconBg: amberTile,
      title: t('more.sections.weight'),
      subtitle: t('more.subtitles.weight'),
      onPress: () => router.push('/weight'),
    },
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
      <Text style={[styles.intro, { color: theme.subtle }, theme.font.body]}>{t('more.intro')}</Text>
      <ListGroup rows={rows} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 14, marginHorizontal: 4 },
});
