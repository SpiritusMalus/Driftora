import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useColorScheme } from 'react-native';

import { SectionCard } from '@/components/SectionCard';
import { colors } from '@/lib/theme/colors';

/// Home dashboard. In M0 it's an empty skeleton; later milestones fill the
/// sections with today's macros, steps, the last win, etc.
export default function HomeScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.greeting, { color: theme.subtle }]}>
        {t('home.greeting')}
      </Text>
      <SectionCard
        icon="restaurant-outline"
        title={t('home.sections.nutrition')}
        subtitle={t('home.comingSoon')}
        theme={theme}
      />
      <SectionCard
        icon="walk-outline"
        title={t('home.sections.steps')}
        subtitle={t('home.comingSoon')}
        theme={theme}
      />
      <SectionCard
        icon="sparkles-outline"
        title={t('home.sections.diary')}
        subtitle={t('home.comingSoon')}
        theme={theme}
      />
      <SectionCard
        icon="trophy-outline"
        title={t('home.sections.wins')}
        subtitle={t('home.comingSoon')}
        theme={theme}
      />
      <Text style={[styles.hint, { color: theme.subtle }]}>
        {t('home.emptyHint')}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  greeting: { fontSize: 15, marginBottom: 16 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 16 },
});
