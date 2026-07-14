import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FillBar } from '@/components/ui/FillBar';
import type { Sex } from '@/lib/core/insights/bodyMetrics';
import { dailyMicroNorms, type MicroRow } from '@/lib/core/insights/microNutrients';
import { nutrientDetailRows } from '@/lib/core/insights/nutrientDetail';
import type { NutrientValues } from '@/lib/core/services/foodParser';
import { type Theme } from '@/lib/theme/theme';

/// Small «≈ примерно» pill — shared by the per-item hero and the meal total.
export function ApproxBadge({ theme, label }: { theme: Theme; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: theme.card, borderColor: theme.primary }]}>
      <Text style={[styles.badgeText, { color: theme.primary }, theme.font.bodySemiBold]}>{label}</Text>
    </View>
  );
}

/// Expandable extended-composition block (fiber/sugar/sat. fat + minerals) for
/// a scaled nutrient set. Renders nothing when the source gave only КБЖУ —
/// we never pad the list with zeros the DB didn't state (HONESTY RULE).
export function NutrientDetail({
  values,
  caption,
  theme,
}: {
  values: NutrientValues;
  caption: string;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rows = nutrientDetailRows(values);
  if (rows.length === 0) return null;
  return (
    <View style={styles.altWrap}>
      <Pressable onPress={() => setOpen((s) => !s)} hitSlop={6}>
        <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
          {open ? t('food.detail.hide') : t('food.detail.show')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailBox}>
          {rows.map((r) => (
            <View key={r.key} style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: theme.subtle }, theme.font.body]}>
                {t(`food.detail.label.${r.key}`)}
              </Text>
              <Text style={[styles.detailValue, { color: theme.text }, theme.font.bodyMedium]}>
                {r.value} {t(`food.detail.unit.${r.unit}`)}
              </Text>
            </View>
          ))}
          <Text style={[styles.detailCaption, { color: theme.subtle }, theme.font.body]}>{caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

/// Vitamins & minerals for a whole dish as a share of the daily norm — the same
/// honest FillBar the day view uses, scoped to what the user is logging now. A
/// bar appears ONLY for a micronutrient the dish actually carries (never an
/// implied zero); collapsed by default so it doesn't crowd the total card.
export function MicroScales({
  values,
  sex,
  estimated,
  theme,
}: {
  values: NutrientValues;
  sex: '' | Sex;
  estimated: boolean;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const measured = dailyMicroNorms(sex)
    .map((row) => ({ row, intake: microIntakeOf(values, row) }))
    .filter((x): x is { row: MicroRow; intake: number } => x.intake != null);
  if (measured.length === 0) return null;
  return (
    <View style={styles.altWrap}>
      <Pressable onPress={() => setOpen((s) => !s)} hitSlop={6}>
        <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
          {open ? t('food.microsDish.hide') : t('food.microsDish.show')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailBox}>
          {(['vitamin', 'mineral'] as const).map((group) => {
            const rows = measured.filter((x) => x.row.group === group);
            if (rows.length === 0) return null;
            return (
              <View key={group} style={styles.microGroup}>
                <Text style={[styles.microGroupHeading, { color: theme.subtle }, theme.font.bodySemiBold]}>
                  {t(`weight.micros.groups.${group}`)}
                </Text>
                {rows.map(({ row, intake }) => {
                  const pct = row.value > 0 ? Math.round((intake / row.value) * 100) : 0;
                  return (
                    <View key={row.key} style={styles.microRow}>
                      <View style={styles.microRowHead}>
                        <Text style={[styles.microName, { color: theme.text }, theme.font.body]}>
                          {t(`weight.micros.name.${row.key}`)}
                        </Text>
                        <Text style={[styles.microVal, { color: theme.subtle }, theme.font.body]}>
                          {fmtMicro(row, intake)} {t(`weight.micros.unit.${row.unit}`)} ·{' '}
                          {t('food.micros.ofNorm', { pct })}
                        </Text>
                      </View>
                      <FillBar value={intake} min={row.value} max={row.limit} thickness={8} />
                    </View>
                  );
                })}
              </View>
            );
          })}
          {sex !== 'male' && sex !== 'female' ? (
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>
              {t('food.microsDish.needSex')}
            </Text>
          ) : null}
          {estimated ? (
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>
              {t('food.microsDish.estimated')}
            </Text>
          ) : null}
          <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>{t('food.microsDish.note')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/// The dish's amount of one norm row, or null when the dish carries none of it
/// (so the caller shows no bar rather than an implied zero). Mirrors the day
/// view's `microIntake`, reading a scaled NutrientValues block.
function microIntakeOf(values: NutrientValues, row: MicroRow): number | null {
  const src = (row.group === 'mineral' ? values.minerals : values.vitamins) as
    | Record<string, number | undefined>
    | undefined;
  const v = src?.[row.key];
  return typeof v === 'number' && v > 0 ? v : null;
}

/// Whole numbers for µg + minerals; sub-mg vitamins keep 1 dp (matches day view).
function fmtMicro(row: MicroRow, v: number): string {
  return row.group === 'vitamin' && row.unit === 'mg' ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString();
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11 },
  altWrap: { marginTop: 8 },
  altToggle: { fontSize: 13 },
  detailBox: { marginTop: 6, gap: 3 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12 },
  detailCaption: { fontSize: 10, fontStyle: 'italic', marginTop: 4, lineHeight: 14 },
  microGroup: { marginTop: 8, gap: 6 },
  microGroupHeading: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  microRow: { gap: 3 },
  microRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  microName: { fontSize: 12 },
  microVal: { fontSize: 11 },
  microNote: { fontSize: 10, fontStyle: 'italic', marginTop: 6, lineHeight: 14 },
});
