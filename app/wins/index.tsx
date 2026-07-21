import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { AUTO_WIN_PROTEIN_GOAL, AUTO_WIN_STEPS_GOAL } from '@/lib/core/db/autoWins';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { Win } from '@/lib/core/db/schema';
import { addWin, listWins } from '@/lib/core/db/settings';
import { DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';
import { useTheme } from '@/lib/theme/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/// Quick-add chips: tap fills the field with a wholesome starter the user can
/// still edit. Fights the blank-page pause without hiding the free-text ritual.
const QUICK_KEYS = ['walk', 'sleep', 'cooked', 'mood'] as const;

/// Celebrate progress: a hero count leads (the reward is watching wins pile up),
/// then a quick log. Rewards are feedback, not pressure — no targets, no
/// judgment. Auto-awarded and hand-logged wins share the list, told apart only
/// by a quiet glyph (coral = earned goal, amber = your own flourish).
export default function WinsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<Win[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  // The delight budget lives HERE (rare, high-emotion screen): the hero count
  // rises in first, the list rides ~60ms behind. One Animated value, staggered
  // by interpolation ranges; instant under Reduce Motion.
  const reduced = useReducedMotion();
  const intro = useRef(new Animated.Value(0)).current;
  const introStarted = useRef(false);
  useEffect(() => {
    if (items == null || introStarted.current) return;
    introStarted.current = true;
    if (reduced) {
      intro.setValue(1);
      return;
    }
    const anim = Animated.timing(intro, {
      toValue: 1,
      duration: DUR.enter + 120,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [items, reduced, intro]);
  const heroIn = {
    opacity: intro.interpolate({ inputRange: [0, 0.7], outputRange: [0, 1], extrapolate: 'clamp' as const }),
    transform: [
      { translateY: intro.interpolate({ inputRange: [0, 0.7], outputRange: [8, 0], extrapolate: 'clamp' as const }) },
    ],
  };
  const listIn = {
    opacity: intro.interpolate({ inputRange: [0.25, 1], outputRange: [0, 1], extrapolate: 'clamp' as const }),
    transform: [
      { translateY: intro.interpolate({ inputRange: [0.25, 1], outputRange: [10, 0], extrapolate: 'clamp' as const }) },
    ],
  };

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listWins(db);
        if (active) setItems(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onShare(message: string) {
    await Share.share({ message });
  }

  async function onAdd() {
    const message = text.trim();
    if (!db || message.length === 0) return;
    setSaving(true);
    try {
      await addWin(db, 'manual', message);
      // A saved win is the rare celebratory beat — a success tap plus the new
      // row sliding in instead of teleporting.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const list = await listWins(db);
      setText('');
      setItems(list);
    } finally {
      setSaving(false);
    }
  }

  const rows: RowSpec[] = (items ?? []).map((w) => {
    const auto = w.kind === AUTO_WIN_STEPS_GOAL || w.kind === AUTO_WIN_PROTEIN_GOAL;
    const icon: IoniconName =
      w.kind === AUTO_WIN_STEPS_GOAL
        ? 'walk'
        : w.kind === AUTO_WIN_PROTEIN_GOAL
          ? 'restaurant'
          : 'sparkles';
    return {
      key: String(w.id),
      icon,
      tint: auto ? theme.primary : theme.accent,
      title: w.message,
      subtitle: formatWinDate(w.ts, t),
      right: (
        <Pressable
          onPress={() => onShare(w.message)}
          hitSlop={8}
          accessibilityLabel={t('wins.share')}
          style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingLeft: 12 })}
        >
          <Ionicons name="share-outline" size={18} color={theme.subtle} />
        </Pressable>
      ),
    };
  });

  const hasWins = items != null && items.length > 0;
  const streak = hasWins ? winStreak(items) : 0;

  return (
    <Screen>
      {hasWins ? (
        <Animated.View style={[styles.hero, heroIn]}>
          <Text style={[styles.heroLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
            {t('wins.totalLabel').toUpperCase()}
          </Text>
          <View style={styles.heroRow}>
            <Text style={[styles.heroNum, { color: theme.heroAccent }, theme.font.display]}>
              {items.length}
            </Text>
            {streak >= 2 ? (
              <Text style={[styles.heroStreak, { color: theme.subtle }, theme.font.bodyMedium]}>
                {t('wins.streak', { days: streak })}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      ) : items != null ? (
        <Text style={[styles.emptyHero, { color: theme.subtle }, theme.font.body]}>
          {t('wins.empty')}
        </Text>
      ) : null}

      <View style={styles.chips}>
        {QUICK_KEYS.map((k) => (
          <Pressable
            key={k}
            onPress={() => setText(t(`wins.quick.${k}`))}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: theme.card, borderColor: theme.cardBorder },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.chipText, { color: theme.text }, theme.font.bodyMedium]}>
              {t(`wins.quick.${k}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      <TextField
        value={text}
        onChangeText={setText}
        placeholder={t('wins.addPlaceholder')}
        style={styles.input}
      />
      <PrimaryButton
        label={t('wins.add')}
        onPress={onAdd}
        disabled={db == null || text.trim().length === 0 || saving}
        style={styles.add}
      />

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('wins.dbUnavailable')}</Text>
      ) : hasWins ? (
        <Animated.View style={[styles.list, listIn]}>
          <ListGroup rows={rows} />
        </Animated.View>
      ) : null}
    </Screen>
  );
}

/// Warm relative stamp reusing the History labels: "Сегодня 14:32" / "Вчера
/// 14:32" for the last two days, else a quiet "12 июля" (the exact minute is
/// noise once the day is old). Also fixes the old hand-rolled dd.mm ordering,
/// which read as an invalid month in the English build.
function formatWinDate(d: Date, t: (key: string) => string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return `${t('history.today')} ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `${t('history.yesterday')} ${time}`;
  return `${d.getDate()} ${t(`history.m${d.getMonth() + 1}`)}`;
}

function dayKeyLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/// Consecutive days (through today or yesterday) with at least one win. Anchored
/// to yesterday too, so an as-yet-unlogged today doesn't read the streak as
/// broken. Zero when the last win is older than yesterday.
function winStreak(items: Win[]): number {
  if (items.length === 0) return 0;
  const days = new Set(items.map((w) => dayKeyLocal(w.ts)));
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  let cursor: Date;
  if (days.has(dayKeyLocal(now))) cursor = new Date(now);
  else if (days.has(dayKeyLocal(yesterday))) cursor = yesterday;
  else return 0;
  let streak = 0;
  while (days.has(dayKeyLocal(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

const styles = StyleSheet.create({
  // Hero — total wins big (coral, the reward), streak riding under it.
  hero: { marginTop: 8, marginBottom: 16 },
  heroLabel: { fontSize: 12, letterSpacing: 1.44, marginBottom: 4 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  heroNum: { fontSize: 40, lineHeight: 44 },
  heroStreak: { fontSize: 14, lineHeight: 19 },
  emptyHero: { fontSize: 15, lineHeight: 21, marginTop: 8, marginBottom: 16 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  chipText: { fontSize: 14 },

  input: { marginBottom: 12 },
  add: { marginBottom: 16 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { marginTop: 4 },
});
