import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AccordionChevron } from '@/components/ui/AccordionChevron';
import { Card } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme/theme';

/// «Как это работает» — the honesty page: where every number in the app comes
/// from, what its real accuracy is, and how to raise the daily budget. A two-line
/// hero states the north-star (every number is an estimate; the real instrument
/// is the weight trend); the six sections are collapsible so the "quiet detail"
/// that keeps migrating here never walls off into a long scroll. «Норма» opens
/// first, the rest show a one-line teaser until tapped. Content lives in i18n so
/// both locales stay in step. Linked from «Ещё», the plan card on «Весе», the day
/// budget on «Еде» and the body-setup result.
const SECTIONS = ['norm', 'budget', 'food', 'workouts', 'boost', 'honesty'] as const;

export default function HowItWorksScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState<Record<string, boolean>>({ norm: true });

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={[styles.heroLine, { color: theme.heroText }, theme.font.heading]}>{t('howItWorks.hero')}</Text>
        <Text style={[styles.heroLine, { color: theme.heroAccent }, theme.font.heading]}>
          {t('howItWorks.heroLead')}
        </Text>
      </View>
      {SECTIONS.map((key) => {
        const expanded = !!open[key];
        return (
          <Card key={key} style={styles.card}>
            <Pressable
              onPress={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              style={styles.head}
            >
              <Text style={[styles.title, { color: theme.text }, theme.font.bodyBold]}>
                {t(`howItWorks.${key}.title`)}
              </Text>
              <AccordionChevron expanded={expanded} size={16} color={theme.tertiary} />
            </Pressable>
            <Collapsible open={expanded}>
              <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>{t(`howItWorks.${key}.body`)}</Text>
            </Collapsible>
            <Collapsible open={!expanded}>
              <Text style={[styles.teaser, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
                {t(`howItWorks.${key}.teaser`)}
              </Text>
            </Collapsible>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: 4, marginBottom: 18, marginHorizontal: 4 },
  heroLine: { fontSize: 20, lineHeight: 27 },
  card: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, flex: 1, paddingRight: 12 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  teaser: { fontSize: 14, lineHeight: 20, marginTop: 4 },
});
