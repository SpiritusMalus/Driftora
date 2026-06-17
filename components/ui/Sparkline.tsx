import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
// Arc path length ≈145; 160 hides it fully before the draw-on (HERO_BRIDGE_SPEC §4).
const DASH = 160;

/// The upward arc bridging Body→Mind in the hero — the semantic centre of the
/// product, not decoration (UI_HANDOFF §4.2/§8, HERO_BRIDGE_SPEC). A coral→amber
/// gradient curve rises from a coral dot (body) to an amber dot (mind), exact V2
/// geometry, and draws itself in left-to-right once over ~1.6s on mount.
export function Sparkline({ coral, amber }: { coral: string; amber: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [progress]);

  const dashoffset = progress.interpolate({ inputRange: [0, 1], outputRange: [DASH, 0] });

  return (
    <Svg width={132} height={46} viewBox="0 0 132 46" fill="none">
      <Defs>
        <LinearGradient id="bridge" x1="0" y1="0" x2="132" y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={coral} />
          <Stop offset="1" stopColor={amber} />
        </LinearGradient>
      </Defs>
      <AnimatedPath
        d="M6 38 C 38 6, 94 6, 126 38"
        stroke="url(#bridge)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={DASH}
        strokeDashoffset={dashoffset}
      />
      <Circle cx={6} cy={38} r={5} fill={coral} />
      <Circle cx={126} cy={38} r={5} fill={amber} />
    </Svg>
  );
}
