import type { Ionicons } from '@expo/vector-icons';
import { type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Theme, useTheme } from '@/lib/theme/theme';

/// The Body↔Mind insight, followed by the two observed signal/value pairs.
/// Both platforms use the approved open text-and-metrics composition.
///
/// PRESENTATIONAL ONLY — the caller resolves the BodyMindResult into localized
/// strings. Findings, building-up and no-link states keep the caller's exact
/// headline, basis, accent and metric values; no chart implies extra data.
export function BodyMindCard({
  eyebrow,
  accent,
  headline,
  basis,
  caption,
  bodyLabel,
  bodyValue,
  mindLabel,
  mindValue,
  compact = false,
}: {
  eyebrow: string;
  accent?: string;
  headline: string;
  basis?: string;
  caption?: string;
  bodyLabel: string;
  bodyValue: string;
  /// Retained for caller compatibility; the metric pair now uses text only.
  bodyIcon?: ComponentProps<typeof Ionicons>['name'];
  mindLabel: string;
  mindValue: string;
  /// Compact recap for the Mind pane (/mood), where the check-in is the hero:
  /// only the "association, not cause" caption drops so the card stays short.
  compact?: boolean;
}) {
  const theme = useTheme();

  const content = (
    <>
      <View style={styles.head}>
        <Text style={[styles.eyebrow, { color: theme.text }, theme.font.heading]}>{eyebrow}</Text>
        <Text style={[styles.accent, { color: theme.heroAccent }, theme.font.bodyMedium]}>{accent ?? ' '}</Text>
      </View>

      <Text style={[styles.headline, { color: theme.heroText }, theme.font.bodySemiBold]}>
        {headline}
      </Text>
      {basis ? (
        <Text style={[styles.basis, { color: theme.subtle }, theme.font.body]}>{basis}</Text>
      ) : null}
      {caption && !compact ? (
        <Text style={[styles.caption, { color: theme.subtle }, theme.font.body]}>{caption}</Text>
      ) : null}
      <View style={styles.columns}>
        <Column theme={theme} label={bodyLabel} value={bodyValue} />
        <Column theme={theme} label={mindLabel} value={mindValue} />
      </View>
    </>
  );

  return (
    <View style={[styles.section, { borderColor: theme.separator }]}>
      {content}
    </View>
  );
}

function Column({
  theme,
  label,
  value,
}: {
  theme: Theme;
  label: string;
  value: string;
}) {
  return (
    <View style={[styles.column, { borderColor: theme.separator }]}>
      <Text style={[styles.colLabel, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      <Text
        style={[
          styles.colValue,
          { color: theme.heroText },
          theme.font.bodyMedium,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: 20 },

  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  eyebrow: { flex: 1, fontSize: 18, lineHeight: 24, letterSpacing: -0.25 },

  columns: { flexDirection: 'row', gap: 16, marginTop: 16 },
  column: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  colLabel: { fontSize: 12, lineHeight: 17, flex: 1 },
  colValue: { fontSize: 17, lineHeight: 23, fontVariant: ['tabular-nums'] },
  accent: { fontSize: 20, lineHeight: 26, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },

  headline: { fontSize: 14, lineHeight: 21, marginTop: 10 },
  basis: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  caption: { fontSize: 13, marginTop: 6, lineHeight: 19 },
});
