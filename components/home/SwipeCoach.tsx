import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// One-time interactive coach for the «mind behind a left swipe» gesture — the
/// Home mood row became a swipe (2026-07-12), and a gesture nobody performed
/// once is a gesture nobody knows about. The overlay dims Home and completes
/// only through a REAL leftward swipe (doing beats reading). «Позже» is the
/// escape hatch — screen-reader and motor-impaired users can't pan-swipe, and
/// they keep the tappable path via «Разделы» → «Настроение и дневник». Either
/// way the parent persists the shown-once flag, so the coach never returns.
export function SwipeCoach({ onSwiped, onLater }: { onSwiped: () => void; onLater: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();

  // The PanResponder is created once — route the success callback through a
  // ref so the captured closure never goes stale across parent re-renders,
  // and fire it a single time even though move events keep streaming.
  const onSwipedRef = useRef(onSwiped);
  onSwipedRef.current = onSwiped;
  const firedRef = useRef(false);
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        if (g.dx < -56 && !firedRef.current) {
          firedRef.current = true;
          onSwipedRef.current();
        }
      },
    }),
  ).current;

  // Gentle entry + a looping finger-trace: a dot glides leftward along a track
  // and fades out — the gesture drawn as a picture, no words needed.
  const enter = useRef(new Animated.Value(0)).current;
  const trace = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.timing(trace, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, trace]);
  const dotX = trace.interpolate({ inputRange: [0, 1], outputRange: [56, -56] });
  const dotOpacity = trace.interpolate({
    inputRange: [0, 0.15, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        styles.scrim,
        {
          backgroundColor: theme.scheme === 'light' ? 'rgba(31,22,16,0.45)' : 'rgba(0,0,0,0.6)',
          opacity: enter,
        },
      ]}
      {...pan.panHandlers}
      accessibilityViewIsModal
    >
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
        <View style={[styles.iconTile, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name="happy-outline" size={30} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>
          {t('home.swipeCoach.title')}
        </Text>
        <Text style={[styles.body, { color: theme.subtle }, theme.font.body]}>
          {t('home.swipeCoach.body')}
        </Text>
        <View style={[styles.track, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name="chevron-back" size={16} color={theme.primary} />
          <Animated.View
            style={[
              styles.dot,
              { backgroundColor: theme.primary, opacity: dotOpacity, transform: [{ translateX: dotX }] },
            ]}
          />
        </View>
        <Text style={[styles.tryNow, { color: theme.primary }, theme.font.bodyMedium]}>
          {t('home.swipeCoach.try')}
        </Text>
        <Pressable onPress={onLater} hitSlop={10} accessibilityRole="button">
          <Text style={[styles.later, { color: theme.subtle }, theme.font.body]}>
            {t('home.swipeCoach.later')}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { justifyContent: 'center', paddingHorizontal: 26, zIndex: 10 },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingVertical: 26,
    alignItems: 'center',
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 18, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  track: {
    marginTop: 20,
    height: 44,
    alignSelf: 'stretch',
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 26, height: 26, borderRadius: 13, marginLeft: 6 },
  tryNow: { fontSize: 14, marginTop: 14 },
  later: { fontSize: 13, marginTop: 14, paddingVertical: 4 },
});
