import { type ReactNode } from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// A plain white content card. Android gets a warm hairline border and a soft
/// elevation; iOS gets a flat grouped-list card (no border, no shadow). Used for
/// inputs, list items, and any standalone surface that isn't a ListGroup row.
/// Pass `onPress` to make the whole card a tap target.
export function Card({
  children,
  style,
  padded = true,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const cardStyle = [
    theme.isIOS ? styles.ios : styles.android,
    padded && styles.padded,
    {
      backgroundColor: theme.card,
      borderColor: theme.cardBorder,
    },
    !theme.isIOS && shadow,
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

const shadow = {
  shadowColor: '#14212E',
  shadowOpacity: 0.05,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 1,
};

const styles = StyleSheet.create({
  android: { borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
  ios: { borderRadius: 18 },
  padded: { padding: 16 },
});
