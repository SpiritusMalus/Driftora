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
  mindLabel: string;
  mindValue: string;
}) {
  const theme = useTheme();
  const showColumns = accent != null;

  const content = (
    <>
      <Text
        style={[
          styles.eyebrow,
          { color: theme.isIOS ? theme.subtle : theme.bodyMindEyebrow },
          theme.font.bodyBold,
          theme.isIOS && styles.eyebrowIOS,
        ]}
      >
        {eyebrow.toUpperCase()}
      </Text>

      {showColumns ? (
        <View style={styles.columns}>
          <Column
            theme={theme}
            icon="walk-outline"
            tint={theme.primary}
            tile={theme.scheme === 'light' ? '#FBE2D9' : '#3A241B'}
            label={bodyLabel}
            value={bodyValue}
          />
          <View style={styles.center}>
            <Text style={[styles.accent, { color: theme.heroAccent }, theme.font.display]}>
              {accent}
            </Text>
            <Sparkline coral={theme.primary} amber={theme.accent} />
          </View>
          <Column
            theme={theme}
            icon="happy-outline"
            tint={theme.accent}
            tile={theme.scheme === 'light' ? '#FBEFD9' : '#33261F'}
            label={mindLabel}
            value={mindValue}
          />
        </View>
      ) : null}

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
      colors={theme.bodyMindGradient}
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
      <View style={[styles.tile, { backgroundColor: theme.isIOS ? tile : '#FFFFFF' }]}>
        <Ionicons name={icon as never} size={21} color={tint} />
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

  eyebrow: { fontSize: 12, letterSpacing: 1.1 },
  eyebrowIOS: { letterSpacing: -0.08, fontWeight: '400' },

  columns: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, marginTop: 12 },
  column: { width: 64, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 14 },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  colLabel: { fontSize: 11, marginTop: 6 },
  colValue: { fontSize: 15, marginTop: 2 },
  accent: { fontSize: 30, lineHeight: 32, letterSpacing: -0.6 },

  headline: { fontSize: 16, lineHeight: 22, marginTop: 12 },
  basis: { fontSize: 13, marginTop: 10 },
  caption: { fontSize: 12, marginTop: 8, lineHeight: 17 },
});
