import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { useReducedMotion } from '@/lib/theme/motion';
import { useTheme } from '@/lib/theme/theme';
import { WAIT_SCENES } from './waitScenes';

/// The wait card for a long parse: one of the nine signal-room scenes at
/// random, framed on quiet graph paper, with the spinner+label row below.
/// The pick happens once per mount — every parse greets the user with a
/// fresh vignette, which is the whole anti-boredom idea (owner, 2026-08-21).
const SCENE_H = 150;

export function WaitScene({ label }: { label: string }) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [w, setW] = useState(0);
  const sceneIndex = useRef(Math.floor(Math.random() * WAIT_SCENES.length)).current;
  const Scene = WAIT_SCENES[sceneIndex];
  return (
    <View style={styles.wrap}>
      <View
        style={[styles.frame, { borderColor: theme.separator, backgroundColor: theme.card }]}
        onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
      >
        {w > 0 ? (
          <>
            <GridLines w={w} h={SCENE_H} color={theme.separator} />
            <Scene w={w} h={SCENE_H} theme={theme} reduced={reduced} />
          </>
        ) : null}
      </View>
      <View style={styles.labelRow}>
        <ActivityIndicator size="small" color={theme.primary} />
        <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      </View>
    </View>
  );
}

/// Faint graph-paper grid behind every scene — the «миллиметровка» ground.
/// Static and cheap: two line families, minor 8px / major 40px.
function GridLines({ w, h, color }: { w: number; h: number; color: string }) {
  const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
  for (let x = 8; x < w; x += 8) lines.push({ x1: x, y1: 0, x2: x, y2: h, major: x % 40 === 0 });
  for (let y = 8; y < h; y += 8) lines.push({ x1: 0, y1: y, x2: w, y2: y, major: y % 40 === 0 });
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
      {lines.map((l, i) => (
        <Line
          key={i}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke={color}
          strokeWidth={1}
          opacity={l.major ? 0.4 : 0.18}
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 8 },
  frame: { borderRadius: 12, borderWidth: 1, overflow: 'hidden', height: SCENE_H },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13 },
});
