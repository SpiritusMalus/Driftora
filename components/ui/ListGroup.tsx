import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type Theme, useTheme } from '@/lib/theme/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface RowSpec {
  key: string;
  /// Optional — icon-less rows (e.g. a date→value history line) drop the tile
  /// and inset their separator to the row edge.
  icon?: IoniconName;
  /// Brand color for the glyph.
  tint?: string;
  /// Retained for caller compatibility; open rows do not draw icon tiles.
  iconBg?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /// Replaces the trailing chevron (e.g. a value or switch).
  right?: ReactNode;
}

/// A list of open icon rows with full-width paper rules on both platforms. This is
/// the workhorse for the Home feeders, the "More" menu, and settings groups.
export function ListGroup({ rows }: { rows: RowSpec[] }) {
  const theme = useTheme();

  if (theme.isIOS) {
    return (
      <View style={[styles.iosCard, { borderColor: theme.separator }]}>
        {rows.map((r, i) => (
          <Row key={r.key} spec={r} theme={theme} last={i === rows.length - 1} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.androidStack}>
      {rows.map((r) => (
        <Row key={r.key} spec={r} theme={theme} last />
      ))}
    </View>
  );
}

function Row({ spec, theme, last }: { spec: RowSpec; theme: Theme; last: boolean }) {
  const tint = spec.tint ?? theme.primary;
  const chevron =
    spec.right !== undefined ? (
      spec.right
    ) : spec.onPress ? (
      <Ionicons name="chevron-forward" size={theme.isIOS ? 16 : 18} color={theme.tertiary} />
    ) : null;

  const inner = theme.isIOS ? (
    <>
      {spec.icon ? (
        <View style={styles.iosIcon}>
          <Ionicons name={spec.icon} size={20} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.iosTitle, { color: theme.text }, theme.font.bodyMedium]}>{spec.title}</Text>
        {spec.subtitle ? (
          <Text style={[styles.iosSubtitle, { color: theme.subtle }, theme.font.body]}>
            {spec.subtitle}
          </Text>
        ) : null}
      </View>
      {chevron}
      {!last ? (
        <View
          style={[
            styles.iosSeparator,
            { backgroundColor: theme.separator },
          ]}
        />
      ) : null}
    </>
  ) : (
    <>
      {spec.icon ? (
        <View style={styles.androidIcon}>
          <Ionicons name={spec.icon} size={21} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.androidTitle, { color: theme.text }, theme.font.bodyMedium]}>
          {spec.title}
        </Text>
        {spec.subtitle ? (
          <Text style={[styles.androidSubtitle, { color: theme.subtle }, theme.font.body]}>
            {spec.subtitle}
          </Text>
        ) : null}
      </View>
      {chevron}
    </>
  );

  const rowStyle = theme.isIOS
    ? styles.iosRow
    : [styles.androidRow, { borderColor: theme.separator }];

  if (spec.onPress) {
    return (
      <Pressable
        onPress={spec.onPress}
        style={({ pressed }) => [rowStyle, pressed && { opacity: 0.6 }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{inner}</View>;
}

const styles = StyleSheet.create({
  iosCard: { borderBottomWidth: StyleSheet.hairlineWidth },
  iosRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, position: 'relative' },
  iosIcon: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center' },
  iosTitle: { fontSize: 16 },
  iosSubtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  iosSeparator: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },

  androidStack: { gap: 0 },
  androidRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  androidIcon: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center' },
  androidTitle: { fontSize: 16 },
  androidSubtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },

  body: { flex: 1 },
});
