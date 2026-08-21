import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/// Animation primitives for the wait scenes. Everything runs on the NATIVE
/// driver (transforms/opacity only): the JS thread is busy exactly never
/// during a parse — it is awaiting the network — but a dropped frame on a
/// 20-second loop still reads as «дёшево», which is the one thing the scenes
/// must not be. LayoutAnimation stays banned (Fabric no-op, motion.ts).

/** 0→1 repeating linear ramp — sweeps, tapes, waves, travellers. */
export function useLoop(durationMs: number, reduced: boolean): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    );
    anim.start();
    return () => anim.stop();
  }, [durationMs, reduced, v]);
  return v;
}

/** 0→1→0 repeating ease-in-out — boat rock, lighthouse beam, lamp pulse. */
export function useSwing(durationMs: number, reduced: boolean): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const half = { duration: durationMs / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true };
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, ...half }),
        Animated.timing(v, { toValue: 0, ...half }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [durationMs, reduced, v]);
  return v;
}

/**
 * Opacity «window» on a shared 0..1 loop: off → on inside [from..to] → off,
 * with soft 2% edges. One loop value drives every light in a scene, so the
 * relay/blip choreography stays locked together by construction.
 */
export function windowOpacity(
  loop: Animated.Value,
  from: number,
  to: number,
  off = 0.15,
): Animated.AnimatedInterpolation<number> {
  const e = 0.02;
  return loop.interpolate({
    inputRange: [0, Math.max(0, from - e), from, to, Math.min(1, to + e), 1],
    outputRange: [off, off, 1, 1, off, off],
  });
}

export interface PathPoint {
  x: number;
  y: number;
  angle: number; // degrees, unwrapped so interpolation never spins the long way
}

/** Sample a chain of cubic Béziers into travel points with unwrapped angles. */
export function samplePath(
  segments: { p0: [number, number]; c1: [number, number]; c2: [number, number]; p1: [number, number] }[],
  perSegment = 10,
): PathPoint[] {
  const pts: { x: number; y: number }[] = [];
  for (const s of segments) {
    for (let i = 0; i <= perSegment; i++) {
      const t = i / perSegment;
      const u = 1 - t;
      pts.push({
        x: u * u * u * s.p0[0] + 3 * u * u * t * s.c1[0] + 3 * u * t * t * s.c2[0] + t * t * t * s.p1[0],
        y: u * u * u * s.p0[1] + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * s.p1[1],
      });
    }
  }
  return withAngles(pts);
}

/** Same for a hand-placed polyline (пневмопочта tube and the like). */
export function withAngles(pts: { x: number; y: number }[]): PathPoint[] {
  const out: PathPoint[] = [];
  let prev = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = i < pts.length - 1 ? pts[i + 1] : pts[i];
    const b = i > 0 ? pts[i - 1] : pts[i];
    let angle = (Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI;
    // Unwrap: keep each step within ±180° of the previous so Animated never
    // interpolates through the long way round on a looping course.
    while (angle - prev > 180) angle -= 360;
    while (angle - prev < -180) angle += 360;
    prev = angle;
    out.push({ x: pts[i].x, y: pts[i].y, angle });
  }
  return out;
}

/** translateX/translateY/rotate transform set moving along sampled points. */
export function travelTransforms(loop: Animated.Value, pts: PathPoint[]) {
  const inputRange = pts.map((_, i) => i / (pts.length - 1));
  return [
    { translateX: loop.interpolate({ inputRange, outputRange: pts.map((p) => p.x) }) },
    { translateY: loop.interpolate({ inputRange, outputRange: pts.map((p) => p.y) }) },
    { rotate: loop.interpolate({ inputRange, outputRange: pts.map((p) => `${p.angle}deg`) }) },
  ];
}
