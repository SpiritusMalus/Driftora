import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';

/// Accordion body that actually animates on every RN architecture (the old
/// LayoutAnimation approach was a silent no-op on Fabric Android). Content
/// renders inside an overflow-hidden container; during a fold the height tweens
/// between 0 and the last measured natural height with opacity riding along.
///
/// The height is pinned to the tween ONLY while a transition runs. At rest an
/// open body is plain auto height — a stale measurement can then never clip the
/// content or hide it entirely (device report 2026-08-26: «Как это работает» —
/// раскрытые секции обрезались на полуслове, тизеры свёрнутых карточек
/// пропадали: контейнер оставался на протухшей анимированной высоте). Whatever
/// happens to the animation, the steady states are now dumb and correct; the
/// worst failure mode is a fold that lands without its motion.
///
/// The very first unfold (nothing measured yet) is a pure fade; content
/// unmounts once the close lands, so screen readers never meet hidden
/// leftovers. Under Reduce Motion everything lands instantly.
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [rendered, setRendered] = useState(open);
  const [animating, setAnimating] = useState(false);
  const measured = useRef(0);

  useEffect(() => {
    if (open) setRendered(true);
    if (reduced) {
      progress.setValue(open ? 1 : 0);
      setAnimating(false);
      if (!open) setRendered(false);
      return;
    }
    setAnimating(true);
    const anim = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: DUR.layout,
      easing: EASE_OUT,
      useNativeDriver: false, // height is a layout prop
    });
    // stop() (the cleanup below) also fires this callback with finished:false,
    // so `animating` can never stay stuck at true after an interrupted fold.
    anim.start(({ finished }) => {
      setAnimating(false);
      if (finished && !open) setRendered(false);
    });
    return () => anim.stop();
  }, [open, reduced, progress]);

  if (!rendered) return null;

  // Pinned only mid-transition and only once a real measure exists; the first
  // unfold has nothing to tween to and falls back to the fade.
  const pinned = animating && measured.current > 0;
  return (
    <Animated.View
      style={{
        opacity: animating ? progress : 1,
        overflow: 'hidden',
        height: pinned
          ? progress.interpolate({ inputRange: [0, 1], outputRange: [0, measured.current] })
          : undefined,
      }}
    >
      <View
        onLayout={(e) => {
          measured.current = Math.ceil(e.nativeEvent.layout.height);
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}
