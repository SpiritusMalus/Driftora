import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing, LayoutAnimation, Platform, UIManager } from 'react-native';

/// «Миллиметровка» motion vocabulary — the printing/drafting language: short
/// ease-out moves under 300ms, no bounce. One shared set of timings so screens
/// never invent parallel values (animation pass, 2026-07-20).
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const DUR = { press: 120, select: 160, fade: 180, layout: 220, enter: 240 } as const;

// Legacy Android needs the experimental switch for LayoutAnimation; on the new
// architecture the call is a harmless no-op.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/// System «Reduce Motion»: animations degrade to instant, haptics stay.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/// Smooth the NEXT layout change (accordion unfold, list insert/remove, the
/// mood pill growing). Call right before the state update; no-op under Reduce
/// Motion so content still lands instantly.
export function animateLayout(reduced: boolean, duration: number = DUR.layout): void {
  if (reduced) return;
  LayoutAnimation.configureNext({
    duration,
    create: { type: 'easeInEaseOut', property: 'opacity' },
    update: { type: 'easeInEaseOut' },
    delete: { type: 'easeInEaseOut', property: 'opacity' },
  });
}
