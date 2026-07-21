import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';

import { DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';

/// Mount entrance for a freshly created row: fade + 8dp rise over 240ms, the
/// «печать» language. `enabled={false}` renders statically — pass it for rows
/// that were already on screen (only NEW content earns the move). Instant
/// under Reduce Motion.
export function RiseIn({
  children,
  enabled = true,
  style,
}: {
  children: ReactNode;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(enabled ? 0 : 1)).current;

  useEffect(() => {
    if (!enabled || reduced) {
      v.setValue(1);
      return;
    }
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: DUR.enter,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [enabled, reduced, v]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
