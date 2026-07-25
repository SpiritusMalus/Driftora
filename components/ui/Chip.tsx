import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A selectable pill — the app's most-repeated control. Meal of day, workout
/// type, step goal, sex, activity level: five screens had hand-rolled the same
/// Pressable + Text + «filled when active, outlined when not» colour logic,
/// which is how three of them ended up with no accessibility state at all. A
/// screen reader announced «Обед» and «Ужин» identically whether or not one of
/// them was chosen.
///
/// Sizes are the geometries already in the app, not new ones — the point of
/// this component is to stop the logic drifting, not to restyle five screens
/// blind:
///
///   • `sm`  — inline pills in a wrapping row (meal of day, workout type, the
///             weight screen's quick picks). The most common.
///   • `lg`  — the body-setup wizard's answers: bigger type and a taller tap
///             target for the one-question-per-screen flow.
///   • `block` — a full-width segmented row (the settings step goal): equal
///             thirds, a heavier border and centred semibold labels.
export type ChipSize = 'sm' | 'lg' | 'block';

export function Chip({
  label,
  selected,
  onPress,
  size = 'sm',
  accessibilityLabel,
  boldWhenSelected = false,
  disabled,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  size?: ChipSize;
  /// Defaults to `label`; pass one when the visible text is an abbreviation.
  accessibilityLabel?: string;
  /// Thickens the label while chosen. A few rows lean on weight as well as
  /// fill; most rely on the fill alone.
  boldWhenSelected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // The one thing every hand-rolled copy of this control was missing.
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        {
          backgroundColor: selected ? theme.primary : theme.card,
          borderColor: selected ? theme.primary : theme.separator,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      <Text
        style={[
          textStyles[size],
          { color: selected ? theme.onPrimary : theme.text },
          boldWhenSelected && selected ? theme.font.bodySemiBold : chipFont(theme, size),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/// A row of chips with the app's standard 8pt gap. `block` chips share the row
/// in equal parts; the others wrap.
export function ChipRow({
  size = 'sm',
  style,
  children,
}: {
  size?: ChipSize;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return <View style={[size === 'block' ? styles.blockRow : styles.wrapRow, style]}>{children}</View>;
}

function chipFont(theme: ReturnType<typeof useTheme>, size: ChipSize) {
  return size === 'block' ? theme.font.bodySemiBold : theme.font.body;
}

const styles = StyleSheet.create({
  base: { borderRadius: 999 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  blockRow: { flexDirection: 'row', gap: 8 },
});

const sizeStyles = StyleSheet.create({
  sm: { borderWidth: 1, paddingVertical: 7, paddingHorizontal: 12 },
  lg: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 16 },
  block: { flex: 1, borderWidth: 1.5, paddingVertical: 9, alignItems: 'center' },
});

const textStyles = StyleSheet.create({
  sm: { fontSize: 13 },
  lg: { fontSize: 15 },
  block: { fontSize: 14 },
});
