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
  /// Brand color for the glyph. On Android it tints the glyph inside a soft
  /// tile; on iOS it fills a small rounded square with a white glyph.
  tint?: string;
  /// Android tile background. Defaults to the theme's soft cream tint.
  iconBg?: string;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  /// Replaces the trailing chevron (e.g. a value or switch).
  right?: ReactNode;
}

/// A list of icon rows. iOS renders one inset grouped card with 0.5px hairline
/// separators; Android renders each row as its own softly-shadowed card. This is
/// the workhorse for the Home feeders, the "More" menu, and settings groups.
export function ListGroup({ rows }: { rows: RowSpec[] }) {
  const theme = useTheme();

  if (theme.isIOS) {
    return (
      <View style={[styles.iosCard, { backgroundColor: theme.card }]}>
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
        <View style={[styles.iosIcon, { backgroundColor: tint }]}>
          <Ionicons name={spec.icon} size={17} color="#FFFFFF" />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.iosTitle, { color: theme.text }, theme.font.body]}>{spec.title}</Text>
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
            { backgroundColor: theme.separator, left: spec.icon ? 58 : 16 },
          ]}
        />
      ) : null}
    </>
  ) : (
    <>
      {spec.icon ? (
        <View style={[styles.androidIcon, { backgroundColor: spec.iconBg ?? theme.iconBg }]}>
          <Ionicons name={spec.icon} size={21} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Text style={[styles.androidTitle, { color: theme.text }, theme.font.bodySemiBold]}>
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
    : [styles.androidRow, { backgroundColor: theme.card }, shadow];

  if (spec.onPress) {
    return (
      <Pressable
        onPress={spec.onPress}
        style={({ pressed }) => [rowStyle, pressed && { opacity: theme.isIOS ? 1 : 0.6, backgroundColor: theme.isIOS ? theme.fill : theme.card }]}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={rowStyle}>{inner}</View>;
}

const shadow = {
  shadowColor: '#2A1A14',
  shadowOpacity: 0.05,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 1,
};

const styles = StyleSheet.create({
  // iOS grouped card.
  iosCard: { borderRadius: 18, overflow: 'hidden', marginHorizontal: 0 },
  iosRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, position: 'relative' },
  iosIcon: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  iosTitle: { fontSize: 17 },
  iosSubtitle: { fontSize: 13, marginTop: 1 },
  iosSeparator: { position: 'absolute', left: 58, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },

  // Android floating cards.
  androidStack: { gap: 10 },
  androidRow: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14 },
  androidIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  androidTitle: { fontSize: 15 },
  androidSubtitle: { fontSize: 13, marginTop: 1, lineHeight: 18 },

  body: { flex: 1 },
});
