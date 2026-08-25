import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  type StyleProp,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// Android's answer to the keyboard. `softwareKeyboardLayoutMode: 'resize'`
/// used to make the OS shrink the window, but edge-to-edge (always on since
/// Expo SDK 54, enforced by Android 15) draws the window FULL height behind
/// the system bars — and with `decorFitsSystemWindows=false` the OS silently
/// ignores adjustResize. Nobody in the native tree applies the IME inset
/// either, so the keyboard just painted OVER the bottom of every screen
/// (device report 2026-08-25: «клавиатура перекрывает текст, приложение не
/// подстраивается»).
///
/// So the scroll view compensates itself: the reported keyboard height
/// becomes extra bottom padding (everything stays reachable), and the focused
/// field is scrolled above the keyboard the moment it opens. Returns 0 on iOS
/// — there `automaticallyAdjustKeyboardInsets` already owns the job.
export function useAndroidKeyboardSpace(scrollRef: RefObject<ScrollView | null>): number {
  const [space, setSpace] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'ios') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setSpace(e.endCoordinates.height);
      // The extra offset keeps a line of breathing room between the field's
      // bottom edge and the keyboard, so the caret is never flush with it.
      const input = TextInput.State.currentlyFocusedInput();
      const scroll = scrollRef.current;
      if (input != null && scroll != null) {
        scroll.getScrollResponder().scrollResponderScrollNativeHandleToKeyboard(input, 24, true);
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setSpace(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollRef]);
  return space;
}

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
  const scrollRef = useRef<ScrollView>(null);
  const keyboardSpace = useAndroidKeyboardSpace(scrollRef);
  return (
    <ScrollView
      ref={scrollRef}
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[
        theme.isIOS ? styles.iosContent : styles.androidContent,
        contentStyle,
        // Last, so it wins over any contentStyle padding: while the keyboard
        // is open the content needs its height added back (see the hook above).
        keyboardSpace > 0 ? { paddingBottom: keyboardSpace + 32 } : null,
      ]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      // Nothing in the app handled the keyboard: it opened OVER the field being
      // typed into, and on the short screens (вес, настройки, дневник) the input
      // ended up under it with no way to scroll to it. Every input screen but
      // one goes through this component, so the fix belongs here rather than in
      // nine places.
      //
      // iOS: RN adds the keyboard's height as a content inset and takes it back
      // on dismiss — no KeyboardAvoidingView, so no fighting over the header
      // offset (the usual source of a jumping layout). Android gets the same
      // treatment in JS via [useAndroidKeyboardSpace] — the manifest's
      // adjustResize is dead under edge-to-edge.
      automaticallyAdjustKeyboardInsets
      // Dismissing by dragging is what people already expect; on Android
      // 'interactive' is not supported, so it gets the honest equivalent.
      keyboardDismissMode={theme.isIOS ? 'interactive' : 'on-drag'}
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
