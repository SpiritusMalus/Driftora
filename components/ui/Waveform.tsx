import { useMemo } from 'react';
import { type DimensionValue, StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

export { pushLevel } from './waveformBuffer';

const BAR_COUNT = 24;
const MIN_BAR = 0.08; // never fully collapse a bar — keeps a calm idle baseline

/// A small, dependency-free amplitude waveform: `BAR_COUNT` bars whose heights
/// come from a rolling buffer of recent mic levels (newest on the right). Purely
/// presentational — it claims nothing about transcription, only that the mic
/// hears you. Renders flat bars when the buffer is empty (Expo Go / no metering).
export function Waveform({ levels }: { levels: readonly number[] }) {
  const theme = useTheme();
  // Right-align the buffer into a fixed BAR_COUNT window so bars scroll in from
  // the right as samples arrive, and the layout never reflows.
  const bars = useMemo(() => {
    const out = new Array<number>(BAR_COUNT).fill(0);
    const slice = levels.slice(-BAR_COUNT);
    for (let i = 0; i < slice.length; i++) {
      out[BAR_COUNT - slice.length + i] = slice[i];
    }
    return out;
  }, [levels]);

  return (
    <View style={styles.row} accessible accessibilityLabel="audio level">
      {bars.map((level, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor: theme.primary,
              height: `${Math.round((MIN_BAR + (1 - MIN_BAR) * level) * 100)}%` as DimensionValue,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 36,
    gap: 3,
    marginBottom: 8,
  },
  bar: { width: 3, borderRadius: 2, minHeight: 2 },
});
