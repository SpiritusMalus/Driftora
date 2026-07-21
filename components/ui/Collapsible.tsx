import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';

/// Accordion body that actually animates on every RN architecture (the old
/// LayoutAnimation approach was a silent no-op on Fabric Android). Content
/// renders inside an overflow-hidden container, its natural height is measured
/// onLayout, and open/close tween the height 0↔measured with opacity riding
/// along. The very first unfold (nothing measured yet) falls back to a pure
/// fade; every toggle after that gets the full fold. Content unmounts once the
/// close animation lands, so screen readers never meet hidden leftovers.
/// Under Reduce Motion everything lands instantly.
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);
  const [measured, setMeasured] = useState(0);

  useEffect(() => {
    if (open) setRendered(true);
    if (reduced) {
      progress.setValue(open ? 1 : 0);
      if (!open) setRendered(false);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: DUR.layout,
      easing: EASE_OUT,
      useNativeDriver: false, // height is a layout prop
    });
    anim.start(({ finished }) => {
      if (finished && !open) setRendered(false);
    });
    return () => anim.stop();
  }, [open, reduced, progress]);

  if (!rendered) return null;

  return (
    <Animated.View
      style={{
        opacity: progress,
        overflow: 'hidden',
        // Before the first measure the height stays automatic, so an opening
        // section can never get trapped at 0.
        height:
          measured > 0
            ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, measured] })
            : undefined,
      }}
    >
      <View onLayout={(e) => setMeasured(Math.ceil(e.nativeEvent.layout.height))}>{children}</View>
    </Animated.View>
  );
}
