import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AccordionChevron } from '@/components/ui/AccordionChevron';
import { Card } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import { Screen } from '@/components/ui/Screen';
import { useTheme, type Theme } from '@/lib/theme/theme';

/// «Как это работает» — the honesty page: where every number in the app comes
/// from, what its real accuracy is, and how to raise the daily budget. A two-line
/// hero states the north-star (every number is an estimate; the real instrument
/// is the weight trend); the six sections are collapsible so the "quiet detail"
/// that keeps migrating here never walls off into a long scroll. «Норма» opens
/// first, the rest show a one-line teaser until tapped. Content lives in i18n so
/// both locales stay in step. Linked from «Ещё», the plan card on «Весе», the day
/// budget on «Еде» and the body-setup result.
///
/// Readability pass (device feedback 2026-08-26 «сделать более читаемее вид,
/// расставить акценты»): the body is no longer one grey wall — paragraphs get
/// air between them, «· » lines render as a real list with a hanging indent,
/// reading text steps up to 15/22 in the main text color (the 14px subtle grey
/// was the app's known low-contrast tail), and the open section's title takes
/// the accent color so the active topic reads at a glance.
const SECTIONS = ['norm', 'budget', 'food', 'workouts', 'boost', 'honesty'] as const;

/// One i18n body → paragraphs and bullet lists. The content uses two plain
/// conventions ('\n\n' between paragraphs, '· ' bullet lines inside one) — this
/// renders them instead of dumping the markers into a single Text.
function SectionBody({ text, theme }: { text: string; theme: Theme }) {
  return (
    <View style={styles.body}>
      {text.split('\n\n').map((paragraph, pi) => {
        const lines = paragraph.split('\n');
        if (lines.every((l) => l.startsWith('· '))) {
          return (
            <View key={pi} style={styles.bulletBlock}>
              {lines.map((line, li) => (
                <View key={li} style={styles.bulletRow}>
                  <Text style={[styles.bulletMark, { color: theme.heroAccent }, theme.font.bodySemiBold]}>·</Text>
                  <Text style={[styles.bodyText, styles.bulletText, { color: theme.text }, theme.font.body]}>
                    {line.slice(2)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={pi} style={[styles.bodyText, styles.paragraph, { color: theme.text }, theme.font.body]}>
            {paragraph}
          </Text>
        );
      })}
    </View>
  );
}

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
              <Text
                style={[styles.title, { color: expanded ? theme.heroAccent : theme.text }, theme.font.bodyBold]}
              >
                {t(`howItWorks.${key}.title`)}
              </Text>
              <AccordionChevron expanded={expanded} size={16} color={theme.tertiary} />
            </Pressable>
            <Collapsible open={expanded}>
              <SectionBody text={t(`howItWorks.${key}.body`)} theme={theme} />
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
  // Reading text: 15/22 in the main color — the section body is the page's
  // content, not a caption, so it doesn't get the subtle-grey caption styling.
  body: { marginTop: 10 },
  bodyText: { fontSize: 15, lineHeight: 22 },
  paragraph: { marginBottom: 10 },
  bulletBlock: { marginBottom: 10, gap: 4 },
  bulletRow: { flexDirection: 'row' },
  bulletMark: { fontSize: 15, lineHeight: 22, width: 14 },
  bulletText: { flex: 1 },
  teaser: { fontSize: 14, lineHeight: 20, marginTop: 4 },
});
