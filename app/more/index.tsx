import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';

import { SectionCard } from '@/components/SectionCard';
import { colors } from '@/lib/theme/colors';

/// "More" — the home for everything that was demoted off the daily screen so
/// Home can stay a single insight. A plain list of links to routes that already
/// exist (food log, weight, wins, weekly review, settings). No new logic, no
/// metrics — just navigation.
export default function MoreScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const router = useRouter();

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.intro, { color: theme.subtle }]}>{t('more.intro')}</Text>
      <SectionCard
        icon="restaurant-outline"
        title={t('more.sections.food')}
        subtitle={t('more.subtitles.food')}
        theme={theme}
        onPress={() => router.push('/food/log')}
      />
      <SectionCard
        icon="scale-outline"
        title={t('more.sections.weight')}
        subtitle={t('more.subtitles.weight')}
        theme={theme}
        onPress={() => router.push('/weight')}
      />
      <SectionCard
        icon="trophy-outline"
        title={t('more.sections.wins')}
        subtitle={t('more.subtitles.wins')}
        theme={theme}
        onPress={() => router.push('/wins')}
      />
      <SectionCard
        icon="stats-chart-outline"
        title={t('more.sections.review')}
        subtitle={t('more.subtitles.review')}
        theme={theme}
        onPress={() => router.push('/review')}
      />
      <SectionCard
        icon="settings-outline"
        title={t('more.sections.settings')}
        subtitle={t('more.subtitles.settings')}
        theme={theme}
        onPress={() => router.push('/settings')}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
});
