import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

import { DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';

/// The accordion chevron: ONE glyph that rotates 180° in step with the fold
/// (how-it-works idiom) instead of swapping between two icons. Points down
/// when closed, up when open; jumps instantly under Reduce Motion.
export function AccordionChevron({
  expanded,
  size = 16,
  color,
}: {
  expanded: boolean;
  size?: number;
  color: string;
}) {
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      turn.setValue(expanded ? 1 : 0);
      return;
    }
    const anim = Animated.timing(turn, {
      toValue: expanded ? 1 : 0,
      duration: DUR.layout,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [expanded, reduced, turn]);

  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <Ionicons name="chevron-down" size={size} color={color} />
    </Animated.View>
  );
}
