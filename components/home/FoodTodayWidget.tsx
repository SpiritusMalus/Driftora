import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { FillBar } from '@/components/ui/FillBar';
import { formatInt } from '@/lib/core/format';
import { DUR, EASE_OUT, useReducedMotion } from '@/lib/theme/motion';
import { useTheme } from '@/lib/theme/theme';

/// Home widget: today's food at a glance — kcal (or protein) vs target + macros —
/// tapping opens the full food day («Еда за сегодня»). This is the food entry
/// point among the Home widgets (previously food was only reachable via the
/// bottom bar); the bar stays for quick voice/text logging.
///
/// The unboxed day summary keeps one budget rule and three label/value columns.
/// A changed total fades in without animating the amount being reported.
export function FoodTodayWidget({
  kcal,
  targetKcal,
  targetApprox = false,
  movementHint,
  hideCalories = false,
  prot,
  targetProt,
  fat,
  targetFat,
  carb,
  targetCarb,
  onPress,
}: {
  kcal: number;
  targetKcal: number;
  /// True when the target stands on FORECAST steps (median of recent days,
  /// today's not entered yet) — rendered as «≈N» so it never reads as a fact.
  targetApprox?: boolean;
  /// Optional «это без учёта активности…» line — Home passes it while no
  /// movement is logged yet, so the resting number never reads as the day's
  /// ceiling (device feedback 2026-07-10). Null hides it.
  movementHint?: string | null;
  hideCalories?: boolean;
  prot: number;
  targetProt: number;
  fat: number;
  targetFat: number;
  carb: number;
  targetCarb: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const stackMacros = (width - 48) / fontScale < 290;
  const reduced = useReducedMotion();

  // «Печать» нового значения: fade the figure back in when the rounded total
  // actually changes (skip the mount and Reduce Motion — value lands instantly).
  const shown = Math.round(hideCalories ? prot : kcal);
  const shownTarget = hideCalories ? targetProt : targetKcal;
  const prevShown = useRef(shown);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (prevShown.current === shown) return;
    prevShown.current = shown;
    if (reduced) return;
    fade.setValue(0.2);
    const anim = Animated.timing(fade, {
      toValue: 1,
      duration: DUR.fade,
      easing: EASE_OUT,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [shown, reduced, fade]);

  const macros: { key: string; value: number; target: number }[] = [
    { key: 'protein', value: prot, target: targetProt },
    { key: 'fat', value: fat, target: targetFat },
    { key: 'carbs', value: carb, target: targetCarb },
  ];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.summary, { borderColor: theme.separator, opacity: pressed ? 0.8 : 1 }]}
    >
      <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('home.food.title')}</Text>
      <View style={styles.budget}>
        <View style={styles.budgetMain}>
        <Animated.Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
          style={[styles.kcal, { color: theme.primary, opacity: fade }, theme.font.display]}
        >
          {formatInt(shown)}
        </Animated.Text>
        <View style={styles.budgetUnit}>
          <Text style={[styles.kcalUnit, { color: theme.text }, theme.font.body]}>
            {hideCalories ? t('macros.protein') : t('units.kcal')}
          </Text>
          <Text style={[styles.kcalTarget, { color: theme.subtle }, theme.font.body]}>
            / {shownTarget > 0 ? (!hideCalories && targetApprox ? '≈' : '') + formatInt(shownTarget) : '—'}
            {hideCalories ? ` ${t('units.g')}` : ''}
          </Text>
        </View>
        </View>
      </View>
      {shownTarget > 0 ? (
        <View style={styles.kcalBar}>
          {/* Goal scale: the selected nutrient target filled = the bar filled. The old
              headroom scale (a micro-nutrient idiom) left ~40% of track past
              the tick, so a fully eaten day read as unfinished (device
              feedback 2026-08-17: «заполнил всё, а шкалы не адаптивные»). */}
          <FillBar value={hideCalories ? prot : kcal} min={shownTarget} scale="goal" thickness={7} />
        </View>
      ) : null}
      {!hideCalories && movementHint ? (
        <Text style={[styles.movementHint, { color: theme.subtle }, theme.font.body]}>{movementHint}</Text>
      ) : null}

      <View style={[styles.macros, stackMacros && styles.macrosLarge]}>
        {macros.map((m) => (
          <View key={m.key} style={[styles.macro, stackMacros && styles.macroLarge]}>
            <Text style={[styles.macroLabel, { color: theme.subtle }, theme.font.body]}>
              {t(`macros.${m.key}`)}
            </Text>
            <Text style={[styles.macroValue, stackMacros && styles.macroValueLarge, { color: theme.primary }, theme.font.bodyMedium]}>
              {formatInt(m.value)}
              <Text style={[styles.macroTarget, { color: theme.subtle }, theme.font.body]}>
                {'\n'}/{m.target > 0 ? formatInt(m.target) : '—'} {t('units.g')}
              </Text>
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { paddingBottom: 23, borderBottomWidth: 1, borderStyle: 'dashed' },
  title: { fontSize: 26, lineHeight: 34, marginBottom: 14 },
  budget: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kcal: { fontSize: 84, lineHeight: 92, letterSpacing: -1.8, flexShrink: 1 },
  budgetMain: { flex: 1 },
  budgetUnit: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, flexShrink: 1 },
  kcalUnit: { fontSize: 17, lineHeight: 24 },
  kcalTarget: { fontSize: 26, lineHeight: 34 },
  kcalBar: { marginTop: 17 },
  movementHint: { fontSize: 16, marginTop: 12, lineHeight: 24 },
  macros: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 22 },
  macrosLarge: { flexDirection: 'column', gap: 12 },
  macro: { flex: 1, gap: 2 },
  macroLarge: { flex: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12, rowGap: 2 },
  macroLabel: { fontSize: 17, lineHeight: 24 },
  macroValue: { fontSize: 36, lineHeight: 44 },
  macroValueLarge: { flexShrink: 1, maxWidth: '100%', textAlign: 'right' },
  macroTarget: { fontSize: 24, lineHeight: 32 },
});
