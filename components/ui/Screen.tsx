import { type ReactNode } from 'react';
import { ScrollView, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// Scrolling screen container. Paints the platform background (cream on Android,
/// systemGroupedBackground on iOS) and applies the right horizontal rhythm:
/// 18px gutters on Android (Ember), 16px on iOS (grouped insets). iOS leans on
/// the native large-title header, so its top padding is tighter.
export function Screen({
  children,
  contentStyle,
}: {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        theme.isIOS ? styles.iosContent : styles.androidContent,
        contentStyle,
      ]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

/// A bare full-bleed background wrapper (no scroll) for screens that manage
/// their own scrolling or sticky regions.
export function ScreenBackground({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.fill, { backgroundColor: theme.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  androidContent: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
  iosContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
});
