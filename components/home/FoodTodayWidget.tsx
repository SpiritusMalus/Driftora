import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { FillBar } from '@/components/ui/FillBar';
import { formatInt } from '@/lib/core/format';
import { useTheme } from '@/lib/theme/theme';

/** Shared daily balance. Targets come from the existing budget engine. */
export function FoodTodayWidget({
  kcal, targetKcal, targetApprox = false, movementHint, hideCalories = false,
  prot, targetProt, fat, targetFat, carb, targetCarb, onPress, compact = false,
}: {
  kcal: number;
  targetKcal: number;
  targetApprox?: boolean;
  movementHint?: string | null;
  hideCalories?: boolean;
  prot: number;
  targetProt: number;
  fat: number;
  targetFat: number;
  carb: number;
  targetCarb: number;
  onPress?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const largeType = (width - 44) / fontScale < 235;
  const dense = compact && !largeType;
  const hasTarget = targetKcal > 0;
  const eaten = Math.round(kcal);
  const remaining = Math.max(0, Math.round(targetKcal - kcal));
  const excess = Math.max(0, Math.round(kcal - targetKcal));
  const macros = [
    { key: 'protein', value: prot, target: targetProt, color: theme.protein },
    { key: 'fat', value: fat, target: targetFat, color: theme.fat },
    { key: 'carbs', value: carb, target: targetCarb, color: theme.carb },
  ];
  const body = (
    <>
      {!hideCalories ? (
        <View style={[styles.energy, dense && styles.energyCompact]}>
          <View style={[styles.energyColumns, largeType && styles.energyColumnsLarge]}>
            {[
              { label: t('home.food.eaten'), value: formatInt(eaten) },
              { label: t('home.food.remaining'), value: hasTarget ? formatInt(remaining) : '—' },
            ].map((column, index) => (
              <View key={column.label} style={[
                styles.energyColumn,
                index === 1 && !largeType && [styles.secondColumn, { borderColor: theme.separator }],
              ]}>
                <Text style={[styles.energyLabel, dense && styles.energyLabelCompact, theme.font.body, { color: theme.subtle }]}>{column.label}</Text>
                <View style={styles.energyNumberRow}>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
                    style={[styles.energyValue, dense && styles.energyValueCompact, width <= 360 && styles.energyValueNarrow, theme.font.display, { color: theme.text }]}
                  >{column.value}</Text>
                  {column.value !== '—' ? <Text style={[styles.unit, dense && styles.unitCompact, theme.font.body, { color: theme.subtle }]}>{t('units.kcal')}</Text> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={[styles.goalRow, dense && styles.goalRowCompact]}>
            <Text style={[styles.goalText, dense && styles.goalTextCompact, theme.font.body, { color: theme.subtle }]}>
              {hasTarget ? `${t('home.food.dayGoal')} ${targetApprox ? '≈' : ''}${formatInt(Math.round(targetKcal))} ${t('units.kcal')}` : t('home.food.noGoal')}
            </Text>
            {hasTarget ? <Text style={[styles.goalText, dense && styles.goalTextCompact, theme.font.body, { color: excess > 0 ? theme.primary : theme.subtle }]}>
              {excess > 0 ? t('home.food.aboveGoal', { value: formatInt(excess), unit: t('units.kcal') }) : `${Math.round(kcal / targetKcal * 100)}%`}
            </Text> : null}
          </View>
          {hasTarget ? <FillBar value={kcal} min={targetKcal} scale="goal" thickness={5} /> : null}
        </View>
      ) : (
        <Text style={[styles.hiddenNote, theme.font.body, { color: theme.subtle }]}>{t('home.food.hidden')}</Text>
      )}
      <View style={[styles.macroHeader, dense && styles.macroHeaderCompact, largeType && styles.macroHeaderLarge]}>
        {!largeType ? <Text style={[styles.macroName, styles.columnLabel, theme.font.body, { color: theme.subtle }]}>{t('home.food.macroHeading')}</Text> : null}
        <Text style={[styles.valueColumn, styles.columnLabel, theme.font.body, { color: theme.subtle }]}>{t('home.food.eaten')}</Text>
        <Text style={[styles.valueColumn, styles.columnLabel, theme.font.body, { color: theme.subtle }]}>{t('home.food.remaining')}</Text>
      </View>
      {macros.map((macro) => {
        const left = Math.round(macro.target - macro.value);
        const targetKnown = macro.target > 0;
        return (
          <View key={macro.key} style={[styles.macroRow, dense && styles.macroRowCompact, largeType && styles.macroRowLarge, { borderColor: theme.separator }]}>
            <View style={[styles.macroName, styles.macroNameRow, largeType && styles.macroNameLarge]}>
              <View style={[styles.macroMark, { backgroundColor: macro.color }]} />
              <Text style={[styles.nutrientName, theme.font.body, { color: theme.text }]}>{t(`macros.${macro.key}`)}</Text>
            </View>
            <Text style={[styles.valueColumn, styles.macroValue, theme.font.bodyMedium, { color: theme.text }]}>
              {formatInt(Math.round(macro.value))}<Text style={[styles.grams, theme.font.body, { color: theme.subtle }]}> {t('units.g')}</Text>
            </Text>
            <Text style={[styles.valueColumn, left < 0 && targetKnown ? styles.overValue : styles.macroValue, theme.font.body, { color: left < 0 && targetKnown ? theme.primary : theme.subtle }]}>
              {!targetKnown ? '—' : left < 0 ? t('home.food.aboveGoal', { value: formatInt(-left), unit: t('units.g') }) : <>{formatInt(left)}<Text style={styles.grams}> {t('units.g')}</Text></>}
            </Text>
          </View>
        );
      })}
      {!hideCalories && movementHint ? <Text style={[styles.movementHint, theme.font.body, { color: theme.subtle }]}>{movementHint}</Text> : null}
    </>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.summary, { opacity: pressed ? 0.8 : 1 }]}>{body}</Pressable>
  ) : <View style={styles.summary}>{body}</View>;
}

const styles = StyleSheet.create({
  summary: { paddingBottom: 4 },
  energy: { marginBottom: 17 },
  energyCompact: { marginBottom: 14 },
  energyColumns: { flexDirection: 'row', gap: 20 },
  energyColumnsLarge: { flexDirection: 'column', gap: 16 },
  energyColumn: { flex: 1, minWidth: 0 },
  secondColumn: { paddingLeft: 20, borderLeftWidth: StyleSheet.hairlineWidth },
  energyLabel: { fontSize: 16, lineHeight: 23, marginBottom: 4 },
  energyLabelCompact: { marginBottom: 2 },
  energyNumberRow: { alignItems: 'flex-start' },
  energyValue: { fontSize: 50, lineHeight: 58, letterSpacing: -1.8, fontVariant: ['tabular-nums'], flexShrink: 1 },
  energyValueCompact: { lineHeight: 56 },
  energyValueNarrow: { fontSize: 44, lineHeight: 53, letterSpacing: -1.5 },
  unit: { fontSize: 14, lineHeight: 21 },
  unitCompact: { fontSize: 13, lineHeight: 18 },
  goalRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 10, marginBottom: 9 },
  goalText: { fontSize: 13, lineHeight: 20 },
  goalRowCompact: { marginTop: 7, marginBottom: 7 },
  goalTextCompact: { lineHeight: 18 },
  hiddenNote: { fontSize: 15, lineHeight: 23, marginBottom: 20 },
  macroHeader: { flexDirection: 'row', alignItems: 'baseline', paddingBottom: 8 },
  macroHeaderCompact: { paddingBottom: 6 },
  macroHeaderLarge: { paddingLeft: 0 },
  macroName: { flex: 1.35, minWidth: 0 },
  macroNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 5 },
  macroNameLarge: { flexBasis: '100%', flexGrow: 0, marginBottom: 7 },
  nutrientName: { fontSize: 15, lineHeight: 23, flexShrink: 1 },
  macroMark: { width: 3, height: 18, borderRadius: 2 },
  columnLabel: { fontSize: 15, lineHeight: 22 },
  valueColumn: { flex: 1, minWidth: 0, textAlign: 'right' },
  macroRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, minHeight: 48 },
  macroRowCompact: { paddingVertical: 6, minHeight: 44 },
  macroRowLarge: { flexWrap: 'wrap', paddingVertical: 12 },
  macroValue: { fontSize: 24, lineHeight: 32, fontVariant: ['tabular-nums'] },
  grams: { fontSize: 13, lineHeight: 20 },
  overValue: { fontSize: 13, lineHeight: 20 },
  movementHint: { fontSize: 13, lineHeight: 20, marginTop: 10 },
});
