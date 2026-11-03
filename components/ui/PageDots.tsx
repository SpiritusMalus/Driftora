import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

interface Props {
  /// Zero-based index of the active pane.
  index: number;
  /// Total panes (default 2 — the body ⟷ mind day panes).
  count?: number;
  /// Optional tap fallback for readers who see the dots but miss the gesture.
  onPress?: () => void;
  accessibilityLabel?: string;
  /// Visible destination for the tap fallback, when the dots need context.
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/// A page indicator (● ○) that signposts the Home ⟷ Mood left/right swipe. The
/// day has two peer panes — body (food/weight/steps) and mind (mood/diary) —
/// and the swipe between them used to be taught only by a caption that retired
/// after three opens, leaving the gesture unlabelled and easy to confuse with
/// the header «Разделы» link (device feedback 2026-07-18: «я думала я в разделы
/// перейду»). The active pane is a filled primary pill, the other a muted dot;
/// the whole strip is tappable as a fallback path.
export function PageDots({ index, count = 2, onPress, accessibilityLabel, label, style }: Props) {
  const theme = useTheme();
  const dots = (
    <View style={styles.row}>
      {Array.from({ length: count }, (_, i) => {
        const active = i === index;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              active && styles.active,
              { backgroundColor: active ? theme.primary : theme.tertiary },
            ]}
          />
        );
      })}
    </View>
  );
  if (onPress == null) return <View style={[styles.wrap, style]}>{dots}</View>;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={label != null ? 0 : 10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.wrap, label != null && styles.labelled, { opacity: pressed ? 0.5 : 1 }, style]}
    >
      {dots}
      {label != null ? (
        <>
          <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{label}</Text>
          <Ionicons name="chevron-forward" size={14} color={theme.subtle} />
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  labelled: { flexDirection: 'row', gap: 10, minHeight: 44 },
  label: { flexShrink: 1, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  // The active pane stretches into a pill — legible as "you are here".
  active: { width: 18, borderRadius: 3 },
});
