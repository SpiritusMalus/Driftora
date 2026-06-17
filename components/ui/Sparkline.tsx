import Svg, { Circle, Path } from 'react-native-svg';

/// The small upward arc linking Body→Mind in the hero card — a coral curve from
/// a coral dot (body) to an amber dot (mind). Decorative; it echoes the "+gap"
/// finding rather than plotting real data.
export function Sparkline({ coral, amber }: { coral: string; amber: string }) {
  return (
    <Svg width={116} height={40} viewBox="0 0 116 40" fill="none">
      <Path d="M6 32 C 32 6, 84 6, 110 32" stroke={coral} strokeWidth={3} strokeLinecap="round" />
      <Circle cx={6} cy={32} r={4.5} fill={coral} />
      <Circle cx={110} cy={32} r={4.5} fill={amber} />
    </Svg>
  );
}
