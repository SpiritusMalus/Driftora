import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { useTheme } from '@/lib/theme/theme';

/// The «Миллиметровка» signature: a real graph-paper grid behind a hero card —
/// 9dp minor cells with a stronger rule every 4th line, like the notebook.
/// Light theme draws it in the grid's cool blue-grey, the blueprint dark in
/// chalk. Deliberately confined to hero surfaces (the direction's rule: the
/// grid must never become page-wide noise). Purely decorative — absolute-fill,
/// no touch, hidden from screen readers.
export function GridPaper({ radius = 20 }: { radius?: number }) {
  const theme = useTheme();
  const dark = theme.scheme === 'dark';
  const minor = dark ? 'rgba(255,255,255,0.055)' : 'rgba(70,110,140,0.08)';
  const major = dark ? 'rgba(255,255,255,0.13)' : 'rgba(70,110,140,0.17)';

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="mmMinor" width={9} height={9} patternUnits="userSpaceOnUse">
            <Line x1={0} y1={9} x2={9} y2={9} stroke={minor} strokeWidth={1} />
            <Line x1={9} y1={0} x2={9} y2={9} stroke={minor} strokeWidth={1} />
          </Pattern>
          <Pattern id="mmMajor" width={36} height={36} patternUnits="userSpaceOnUse">
            <Line x1={0} y1={36} x2={36} y2={36} stroke={major} strokeWidth={1} />
            <Line x1={36} y1={0} x2={36} y2={36} stroke={major} strokeWidth={1} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#mmMinor)" />
        <Rect width="100%" height="100%" fill="url(#mmMajor)" />
      </Svg>
    </View>
  );
}
