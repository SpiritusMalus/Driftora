import { StyleSheet, Text, View } from 'react-native';

import { type ThemeColors } from '@/lib/theme/colors';

/// The editorial Body↔Mind hero — the typographic centerpiece of Home.
///
/// PRESENTATIONAL ONLY. It holds no business logic and reads no DB/i18n: the
/// caller resolves the `BodyMindResult` into already-localized strings and hands
/// them here. The optional `accent` (e.g. "+1.4") is rendered large and olive as
/// the visual hook; `headline` is the honest sentence; `basis` is the small
/// "based on N days" line; `caption` carries the "association, not cause" framing
/// (or the building-up nudge). Any piece may be omitted for the no-link/building
/// states so the same component renders every honesty state.
export function InsightHero({
  eyebrow,
  accent,
  headline,
  basis,
  caption,
  theme,
}: {
  eyebrow: string;
  accent?: string;
  headline: string;
  basis?: string;
  caption?: string;
  theme: ThemeColors;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.eyebrow, { color: theme.subtle }]}>{eyebrow.toUpperCase()}</Text>
      {accent ? (
        <Text style={[styles.accent, { color: theme.heroAccent }]}>{accent}</Text>
      ) : null}
      <Text style={[styles.headline, { color: theme.heroText }]}>{headline}</Text>
      {basis ? <Text style={[styles.basis, { color: theme.subtle }]}>{basis}</Text> : null}
      {caption ? <Text style={[styles.caption, { color: theme.subtle }]}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 24 },
  eyebrow: {
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: '600',
    marginBottom: 12,
  },
  accent: {
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 60,
    letterSpacing: -1,
    marginBottom: 4,
  },
  headline: {
    fontSize: 26,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  basis: {
    fontSize: 13,
    marginTop: 14,
  },
  caption: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
});
