import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Theme, useTheme } from '@/lib/theme/theme';

import { Sparkline } from './Sparkline';

/// The editorial Body↔Mind hero — the centerpiece of Home. Android paints it on
/// a soft coral gradient with a warm border; iOS uses a flat white grouped card.
///
/// PRESENTATIONAL ONLY — the caller resolves the BodyMindResult into localized
/// strings. When `accent` is present (a real finding) the body/mind columns and
/// the linking sparkline are shown; for the building-up / no-link states only
/// the eyebrow, headline and caption render, so every honesty state is intact.
export function BodyMindCard({
  eyebrow,
  accent,
  headline,
  basis,
  caption,
  bodyLabel,
  bodyValue,
  bodyIcon = 'walk-outline',
  mindLabel,
  mindValue,
}: {
  eyebrow: string;
  accent?: string;
  headline: string;
  basis?: string;
  caption?: string;
  bodyLabel: string;
  bodyValue: string;
  /// The body-column glyph — adapts to the signal the hero speaks about
  /// (steps → walk, sleep → moon, protein → nutrition). Defaults to steps.
  bodyIcon?: React.ComponentProps<typeof Ionicons>['name'];
  mindLabel: string;
  mindValue: string;
}) {
  const theme = useTheme();

  const content = (
    <>
      <Text
        style={[
          styles.eyebrow,
          { color: theme.isIOS ? theme.subtle : theme.bodyMindEyebrow },
          theme.font.bodyBold,
          theme.isIOS ? styles.eyebrowIOS : styles.eyebrowAndroid,
        ]}
      >
        {eyebrow.toUpperCase()}
      </Text>

      {/* The Body↔Mind bridge is the product's core motif and is ALWAYS on
          screen (UI_HANDOFF §8: "не декор — ядро идеи"). The "+gap" figure above
          the arc only appears once there's a real finding; until then the arc
          still draws, with the slot reserved so it doesn't jump. */}
      <View style={styles.columns}>
        <Column
          theme={theme}
          icon={bodyIcon}
          tint={theme.primary}
          tile={theme.primarySoft}
          label={bodyLabel}
          value={bodyValue}
        />
        <View style={styles.center}>
          <Text style={[styles.accent, { color: theme.heroAccent }, theme.font.displayHeavy]}>
            {accent ?? ' '}
          </Text>
          <Sparkline coral={theme.primary} amber={theme.accent} />
        </View>
        <Column
          theme={theme}
          icon="happy-outline"
          tint={theme.accent}
          tile={theme.accentSoft}
          label={mindLabel}
          value={mindValue}
        />
      </View>

      <Text style={[styles.headline, { color: theme.heroText }, theme.font.bodySemiBold]}>
        {headline}
      </Text>
      {basis ? (
        <Text style={[styles.basis, { color: theme.subtle }, theme.font.body]}>{basis}</Text>
      ) : null}
      {caption ? (
        <Text style={[styles.caption, { color: theme.subtle }, theme.font.body]}>{caption}</Text>
      ) : null}
    </>
  );

  if (theme.isIOS) {
    return <View style={[styles.iosCard, { backgroundColor: theme.card }]}>{content}</View>;
  }
  return (
    <LinearGradient
      colors={theme.bodyMindGradient as [string, string, ...string[]]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={[styles.androidCard, { borderColor: theme.bodyMindBorder }]}
    >
      {content}
    </LinearGradient>
  );
}

function Column({
  theme,
  icon,
  tint,
  tile,
  label,
  value,
}: {
  theme: Theme;
  icon: ReactNode | React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  tile: string;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.column}>
      <View style={[styles.tile, { backgroundColor: tile }]}>
        <Ionicons name={icon as never} size={25} color={tint} />
      </View>
      <Text style={[styles.colLabel, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      <Text
        style={[
          styles.colValue,
          { color: theme.heroText },
          theme.isIOS ? theme.font.bodyBold : theme.font.display,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  androidCard: { borderRadius: 26, padding: 20, borderWidth: 1 },
  iosCard: { borderRadius: 18, padding: 18 },

  eyebrow: { fontSize: 12 },
  eyebrowAndroid: { letterSpacing: 1.7, textAlign: 'center' },
  eyebrowIOS: { letterSpacing: -0.08, fontWeight: '400' },

  columns: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, marginTop: 18 },
  column: { width: 78, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 18 },
  tile: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  colLabel: { fontSize: 11, marginTop: 8 },
  colValue: { fontSize: 16, marginTop: 2 },
  accent: { fontSize: 32, lineHeight: 33, letterSpacing: -0.6 },

  headline: { fontSize: 19, lineHeight: 26, letterSpacing: -0.19, marginTop: 22 },
  basis: { fontSize: 13, marginTop: 14 },
  caption: { fontSize: 13, marginTop: 6, lineHeight: 19 },
});
