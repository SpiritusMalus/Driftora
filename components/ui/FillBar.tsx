import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

export interface FillBarProps {
  /// Current amount and the daily norm to fill toward (`min` = RDA / adequate
  /// intake — the "reach this" tick).
  value: number;
  min: number;
  /// Optional safe upper limit — drawn as a second "don't exceed" tick (amber).
  max?: number;
  orientation?: 'horizontal' | 'vertical';
  /// Bar thickness (px): the height of a horizontal bar, the width of a vertical one.
  thickness?: number;
  /// Length (px) of a vertical bar. Horizontal bars fill their parent's width.
  length?: number;
}

/// A fill gauge with reference ticks: the gradient fill shows `value`, one tick
/// marks the daily norm (`min`), and — when provided — a second amber tick marks
/// the safe upper limit (`max`). Honest by construction: it draws only what it's
/// handed, so a 0 renders as an empty bar, never as an implied amount. Purely
/// presentational; all norms/values are decided by the caller.
export function FillBar({ value, min, max, orientation = 'horizontal', thickness = 10, length = 140 }: FillBarProps) {
  const theme = useTheme();
  const horizontal = orientation === 'horizontal';

  // Scale so the norm tick always sits below the far end (headroom above it) and
  // the fill never clips, even when intake runs past the upper limit.
  const ceiling = Math.max(max ?? min * 1.4, min * 1.1, Number.EPSILON);
  const scaleTop = Math.max(ceiling, value);
  const frac = (n: number) => Math.max(0, Math.min(1, scaleTop > 0 ? n / scaleTop : 0));
  const fillFrac = frac(value);
  const minFrac = frac(min);
  const maxFrac = max != null ? frac(max) : null;
  const over = max != null && value > max;

  const trackStyle = horizontal
    ? { height: thickness, width: '100%' as const }
    : { width: thickness, height: length };

  const fillStyle = horizontal
    ? { height: '100%' as const, width: `${fillFrac * 100}%` as const }
    : ({ width: '100%', height: `${fillFrac * 100}%`, position: 'absolute', bottom: 0 } as const);

  // Calm palette, on-brand: the coral primary gradient for the fill, amber only
  // when intake is over the safe limit — never red (the app's tone stays gentle).
  const colors: readonly [string, string] = over
    ? [theme.accent, theme.accent]
    : theme.primaryGradient;

  const notch = (position: number, color: string, key: string) => (
    <View
      key={key}
      pointerEvents="none"
      style={[
        styles.notch,
        { backgroundColor: color },
        horizontal
          ? { left: `${position * 100}%`, top: -2, bottom: -2, width: 2 }
          : { bottom: `${position * 100}%`, left: -2, right: -2, height: 2 },
      ]}
    />
  );

  return (
    <View style={[styles.track, trackStyle, { backgroundColor: theme.fill, borderRadius: thickness }]}>
      <LinearGradient
        colors={colors}
        start={horizontal ? { x: 0, y: 0 } : { x: 0, y: 1 }}
        end={horizontal ? { x: 1, y: 0 } : { x: 0, y: 0 }}
        style={[fillStyle, { borderRadius: thickness }]}
      />
      {/* The norm tick (dark hairline) and, if any, the upper-limit tick (amber). */}
      {notch(minFrac, theme.text, 'min')}
      {maxFrac != null ? notch(maxFrac, theme.accent, 'max') : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { position: 'relative', overflow: 'visible' },
  notch: { position: 'absolute', borderRadius: 1, opacity: 0.65 },
});
