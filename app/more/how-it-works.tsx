import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme/theme';

/// «Как это работает» — the honesty page: where every number in the app comes
/// from, what its real accuracy is, and how to raise the daily budget. Static
/// prose, no state; the content lives in i18n so both locales stay in step.
/// Linked from «Ещё», the plan card on «Весе», the day budget on «Еде» and the
/// body-setup result.
const SECTIONS = ['norm', 'budget', 'food', 'workouts', 'boost', 'honesty'] as const;

export default function HowItWorksScreen() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Screen>
      <Text style={[styles.intro, { color: theme.subtle }, theme.font.body]}>{t('howItWorks.intro')}</Text>
      {SECTIONS.map((key) => (
        <Card key={key} style={styles.card}>
          <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>
            {t(`howItWorks.${key}.title`)}
          </Text>
          <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>{t(`howItWorks.${key}.body`)}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 14, marginHorizontal: 4 },
  card: { marginBottom: 12 },
  title: { fontSize: 15, marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 19 },
});
