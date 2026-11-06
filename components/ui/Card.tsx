import { type ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A flat content surface. Android keeps a paper hairline border; iOS keeps
/// its grouped-list surface (no border). Used for
/// inputs, list items, and any standalone surface that isn't a ListGroup row.
/// Pass `onPress` to make the whole card a tap target.
export function Card({
  children,
  style,
  padded = true,
  variant = 'card',
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /// Open page section; the default remains a contained surface for prompts.
  variant?: 'card' | 'section';
  onPress?: () => void;
}) {
  const theme = useTheme();
  const cardStyle = [
    variant === 'section' ? styles.section : theme.isIOS ? styles.ios : styles.android,
    padded && (variant === 'section' ? styles.sectionPadded : styles.padded),
    {
      backgroundColor: variant === 'section' ? 'transparent' : theme.card,
      borderColor: variant === 'section' ? theme.separator : theme.cardBorder,
    },
    style,
  ];

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.7 : 1 }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  android: { borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  ios: { borderRadius: 10 },
  padded: { padding: 16 },
  section: { borderRadius: 0, borderWidth: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  sectionPadded: { paddingVertical: 18 },
});
