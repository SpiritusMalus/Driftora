import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useReducedMotion } from '@/lib/theme/motion';
import { useTheme } from '@/lib/theme/theme';
import { WAIT_SCENES } from './waitScenes';

/// The wait card for a long parse: one of the nine signal-room scenes at
/// random, framed on the shared paper surface, with the spinner+label row below.
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

/// Preserve the decoration slot without drawing the retired grid texture.
function GridLines(_props: { w: number; h: number; color: string }) {
  return null;
}

const styles = StyleSheet.create({
  wrap: { marginTop: 10, gap: 8 },
  frame: { borderRadius: 8, borderWidth: 1, overflow: 'hidden', height: SCENE_H },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13 },
});
