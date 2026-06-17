import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The 0–10 mood picker. Android draws a tight space-between row of small cream
/// pills with the selected value enlarged into a coral disc; iOS draws a wrapped
/// grid of 40px neutral-fill pills with the selected one coral. Tapping a value
/// calls `onPick`. When `selected` is set it stays highlighted (Home shows the
/// latest check-in; the Mood screen re-highlights after a tap).
export function MoodScale({
  selected,
  onPick,
  disabled,
  variant = 'compact',
}: {
  selected: number | null;
  onPick: (value: number) => void;
  disabled?: boolean;
  /// 'compact' — the inline row on Home (small circles, space-between).
  /// 'grid' — the dedicated Mood screen (44px wrapped tiles; Android squares
  /// with a coral glow when active, iOS filled circles).
  variant?: 'compact' | 'grid';
}) {
  const theme = useTheme();
  const grid = variant === 'grid';

  return (
    <View style={grid ? styles.gridRow : theme.isIOS ? styles.iosRow : styles.androidRow}>
      {Array.from({ length: 11 }, (_, n) => {
        const active = selected === n;
        const base = grid
          ? theme.isIOS
            ? styles.gridCircle
            : styles.gridSquare
          : theme.isIOS
            ? styles.iosPill
            : active
              ? styles.androidActive
              : styles.androidPill;

        const inactiveBg = grid && !theme.isIOS ? theme.card : theme.fill;

        return (
          <Pressable
            key={n}
            onPress={() => onPick(n)}
            disabled={disabled}
            hitSlop={4}
            style={({ pressed }) => [
              base,
              grid && !theme.isIOS && !active && { borderWidth: 1, borderColor: theme.separator },
              active && grid && !theme.isIOS && glow,
              {
                backgroundColor: active ? theme.primary : inactiveBg,
                shadowColor: theme.primary,
                opacity: pressed && !active ? 0.6 : 1,
              },
            ]}
          >
            <Text
              style={[
                grid ? styles.gridLabel : theme.isIOS ? styles.iosLabel : styles.androidLabel,
                { color: active ? theme.onPrimary : grid ? theme.text : theme.subtle },
                active ? theme.font.bodyBold : theme.font.bodyMedium,
              ]}
            >
              {n}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const glow = {
  shadowOpacity: 0.4,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

const styles = StyleSheet.create({
  androidRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  androidPill: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  androidActive: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  androidLabel: { fontSize: 11 },

  iosRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  iosPill: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iosLabel: { fontSize: 17 },

  gridRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridSquare: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  gridCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 16 },
});
