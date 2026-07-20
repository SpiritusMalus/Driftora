import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { animateLayout, DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The 0–10 mood picker. Android draws a tight space-between row of small cool
/// pills with the selected value enlarged into a red disc; iOS draws a wrapped
/// grid of 40px neutral-fill pills with the selected one red. Tapping a value
/// calls `onPick`. When `selected` is set it stays highlighted (Home shows the
/// latest check-in; the Mood screen re-highlights after a tap).
///
/// Motion (animation pass 2026-07-20): press-in scales the pill to 0.92 over
/// 120ms, a light selection haptic confirms the tap, and on the Android compact
/// row the 26→34 growth of the chosen disc is smoothed by a LayoutAnimation
/// instead of teleporting. Reduce Motion keeps everything instant (haptics
/// stay). Pills also carry button role + selected state for screen readers.
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
  /// with a red glow when active, iOS filled circles).
  variant?: 'compact' | 'grid';
}) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const grid = variant === 'grid';

  const pick = (n: number) => {
    void Haptics.selectionAsync().catch(() => {});
    // Android compact: the selected pill CHANGES SIZE — smooth the row's
    // re-layout instead of letting neighbours jump.
    if (!grid && !theme.isIOS) animateLayout(reduced, DUR.select);
    onPick(n);
  };

  return (
    <View style={grid ? styles.gridRow : theme.isIOS ? styles.iosRow : styles.androidRow}>
      {Array.from({ length: 11 }, (_, n) => (
        <MoodPill key={n} n={n} active={selected === n} disabled={disabled} grid={grid} theme={theme} onPick={pick} />
      ))}
    </View>
  );
}

function MoodPill({
  n,
  active,
  disabled,
  grid,
  theme,
  onPick,
}: {
  n: number;
  active: boolean;
  disabled?: boolean;
  grid: boolean;
  theme: Theme;
  onPick: (value: number) => void;
}) {
  const press = useRef(new Animated.Value(1)).current;
  const pressTo = (v: number) =>
    Animated.timing(press, { toValue: v, duration: DUR.press, easing: EASE_OUT, useNativeDriver: true }).start();

  const base = grid
    ? theme.isIOS
      ? styles.gridCircle
      : styles.gridSquare
    : theme.isIOS
      ? styles.iosPill
      : active
        ? styles.androidActive
        : styles.androidPill;

  // Android compact uses the cool moodTrack pills; the Android grid uses
  // bordered card tiles; iOS uses the neutral system fill.
  const inactiveBg = theme.isIOS ? theme.fill : grid ? theme.card : theme.moodTrack;
  const inactiveNum = theme.isIOS ? theme.subtle : grid ? theme.text : theme.moodTrackNum;

  return (
    <Pressable
      onPress={() => onPick(n)}
      onPressIn={() => pressTo(0.92)}
      onPressOut={() => pressTo(1)}
      disabled={disabled}
      // Compact pills sit shoulder to shoulder: generous slop vertically, tiny
      // horizontally so neighbouring hit areas never overlap.
      hitSlop={grid || theme.isIOS ? 4 : { top: 11, bottom: 11, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityLabel={String(n)}
      accessibilityState={{ selected: active, disabled: !!disabled }}
    >
      <Animated.View
        style={[
          base,
          grid && !theme.isIOS && !active && { borderWidth: 1, borderColor: theme.separator },
          active && grid && !theme.isIOS && glow,
          {
            backgroundColor: active ? theme.primary : inactiveBg,
            shadowColor: theme.primary,
            transform: [{ scale: press }],
          },
        ]}
      >
        <Text
          style={[
            grid ? styles.gridLabel : theme.isIOS ? styles.iosLabel : styles.androidLabel,
            { color: active ? theme.onPrimary : inactiveNum },
            active ? theme.font.bodyBold : theme.font.bodyMedium,
          ]}
        >
          {n}
        </Text>
      </Animated.View>
    </Pressable>
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
