import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

/// «Миллиметровка» motion vocabulary — the printing/drafting language: short
/// ease-out moves under 300ms, no bounce. One shared set of timings so screens
/// never invent parallel values (animation pass, 2026-07-20).
///
/// Deliberately NO LayoutAnimation here: it is a silent no-op on Fabric
/// Android (device feedback 2026-07-20 — «не вижу этих анимаций»). Everything
/// animates through the Animated API: transforms/opacity on the native driver,
/// measured height for fold/unfold (see ui/Collapsible, ui/RiseIn).
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
export const DUR = { press: 120, select: 160, fade: 180, layout: 220, enter: 240 } as const;

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
