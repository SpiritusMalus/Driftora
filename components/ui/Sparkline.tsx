import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/// The upward arc bridging Body→Mind in the hero — the semantic centre of the
/// product, not decoration (UI_HANDOFF §4.2/§8). A coral→amber gradient curve
/// rises from a coral dot (body) to an amber dot (mind), exact V2 geometry.
export function Sparkline({ coral, amber }: { coral: string; amber: string }) {
  return (
    <Svg width={132} height={46} viewBox="0 0 132 46" fill="none">
      <Defs>
        <LinearGradient id="bridge" x1="0" y1="0" x2="132" y2="0" gradientUnits="userSpaceOnUse">
          <Stop stopColor={coral} />
          <Stop offset="1" stopColor={amber} />
        </LinearGradient>
      </Defs>
      <Path d="M6 38 C 38 6, 94 6, 126 38" stroke="url(#bridge)" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={6} cy={38} r={5} fill={coral} />
      <Circle cx={126} cy={38} r={5} fill={amber} />
    </Svg>
  );
}
