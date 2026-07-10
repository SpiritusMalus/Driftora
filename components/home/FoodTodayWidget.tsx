import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { FillBar } from '@/components/ui/FillBar';
import { useTheme } from '@/lib/theme/theme';

/// Home widget: today's food at a glance — kcal vs target + a compact КБЖУ row —
/// tapping opens the full food day («Еда за сегодня»). This is the food entry
/// point among the Home widgets (previously food was only reachable via the
/// bottom bar); the bar stays for quick voice/text logging.
export function FoodTodayWidget({
  kcal,
  targetKcal,
  targetApprox = false,
  movementHint,
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
  /// Optional «+ шаги и тренировки увеличат бюджет» line — Home passes it while
  /// no movement is logged yet, so the resting number never reads as the day's
  /// ceiling (device feedback 2026-07-10). Null hides it.
  movementHint?: string | null;
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
  const macros: { key: string; value: number; target: number }[] = [
    { key: 'protein', value: prot, target: targetProt },
    { key: 'fat', value: fat, target: targetFat },
    { key: 'carbs', value: carb, target: targetCarb },
  ];

  return (
    <Card style={styles.card} onPress={onPress}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('home.food.title')}</Text>
        <Ionicons name="chevron-forward" size={16} color={theme.tertiary} />
      </View>

      <Text style={[styles.kcal, { color: theme.text }, theme.font.body]}>
        {Math.round(kcal)}
        <Text style={{ color: theme.subtle }}>
          {' '}
          / {targetKcal > 0 ? (targetApprox ? '≈' : '') + Math.round(targetKcal) : '—'} {t('units.kcal')}
        </Text>
      </Text>
      {targetKcal > 0 ? (
        <View style={styles.kcalBar}>
          <FillBar value={kcal} min={targetKcal} thickness={8} />
        </View>
      ) : null}
      {movementHint ? (
        <Text style={[styles.movementHint, { color: theme.subtle }, theme.font.body]}>{movementHint}</Text>
      ) : null}

      <View style={styles.macros}>
        {macros.map((m) => (
          <View key={m.key} style={styles.macro}>
            <Text style={[styles.macroLabel, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
              {t(`macros.${m.key}`)} {Math.round(m.value)}/{m.target > 0 ? Math.round(m.target) : '—'}
            </Text>
            {m.target > 0 ? <FillBar value={m.value} min={m.target} thickness={6} /> : null}
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 15 },
  kcal: { fontSize: 22, marginTop: 8 },
  kcalBar: { marginTop: 8 },
  movementHint: { fontSize: 12, marginTop: 6, lineHeight: 17 },
  macros: { flexDirection: 'row', gap: 12, marginTop: 12 },
  macro: { flex: 1, gap: 6 },
  macroLabel: { fontSize: 11 },
});
