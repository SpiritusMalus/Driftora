import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FoodEntry } from '@/lib/core/db/schema';
import { formatInt } from '@/lib/core/format';
import { shortMealTitle } from '@/lib/core/insights/mealTitle';
import { mealTypeForEntry } from '@/lib/core/insights/mealType';
import { useTheme } from '@/lib/theme/theme';

/** The selected day ribbon, fed only by the user's existing food records. */
export function DayRibbonTimeline({
  entries,
  hideCalories,
  onOpenDay,
  onOpenEntry,
}: {
  entries: readonly FoodEntry[] | null;
  hideCalories: boolean;
  onOpenDay: () => void;
  onOpenEntry: (entry: FoodEntry) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  // DB day lists are newest-first. The ribbon reads from morning to evening;
  // never mutate the shared query result or change the underlying day list.
  const ordered = entries == null ? null : [...entries].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  return (
    <View style={[styles.section, { borderBottomColor: theme.separator }]}>
      <View style={styles.headingRow}>
        <Text style={[styles.heading, theme.font.heading, { color: theme.text }]}>{t('history.foodSection')}</Text>
        <Pressable onPress={onOpenDay} accessibilityRole="button" accessibilityLabel={t('home.food.title')} style={styles.openDay}>
          <Ionicons name="arrow-forward" size={21} color={theme.text} style={{ transform: [{ rotate: '-45deg' }] }} />
        </Pressable>
      </View>
      {ordered == null ? (
        <ActivityIndicator color={theme.primary} style={styles.loading} />
      ) : ordered.length === 0 ? (
        <Text style={[styles.empty, theme.font.body, { color: theme.subtle }]}>{t('food.emptyDay')}</Text>
      ) : (
        <View style={styles.timeline}>
          <View pointerEvents="none" style={[styles.line, { backgroundColor: theme.separator }]} />
          {ordered.map((entry) => {
            const parsing = entry.parseStatus != null;
            const title = parsing
              ? t(entry.parseStatus === 'pending' ? 'food.bg.parsing' : 'food.bg.failed')
              : t(`food.meal.${entry.meal ?? mealTypeForEntry(entry.rawText, entry.ts)}`);
            const time = `${String(entry.ts.getHours()).padStart(2, '0')}:${String(entry.ts.getMinutes()).padStart(2, '0')}`;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                onPress={() => onOpenEntry(entry)}
                style={({ pressed }) => [styles.entry, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[styles.time, theme.font.body, { color: theme.subtle }]}>{time}</Text>
                <View style={styles.nodeColumn}><View style={[styles.node, { backgroundColor: theme.primary }]} /></View>
                <View style={styles.entryBody}>
                  <Text style={[styles.entryTitle, theme.font.bodyMedium, { color: theme.text }]}>{title}</Text>
                  {parsing ? null : (
                    <Text numberOfLines={2} style={[styles.detail, theme.font.body, { color: theme.subtle }]}>
                      {entry.rawText ? shortMealTitle(entry.rawText) : t('food.untitled')}
                    </Text>
                  )}
                  {!parsing && !entry.confirmed ? (
                    <Text style={[styles.review, theme.font.body, { color: theme.primary }]}>{t('food.bg.review')}</Text>
                  ) : null}
                </View>
                {parsing ? (
                  <View style={styles.status}>
                    {entry.parseStatus === 'pending' ? <ActivityIndicator size="small" color={theme.subtle} /> : <Ionicons name="refresh-outline" size={19} color={theme.primary} />}
                  </View>
                ) : !hideCalories ? (
                  <View style={styles.amount}>
                    <Text style={[styles.kcal, theme.font.bodyMedium, { color: theme.text }]}>{formatInt(Math.round(entry.kcal))}</Text>
                    <Text style={[styles.unit, theme.font.body, { color: theme.subtle }]}>{t('units.kcal')}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 20, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, lineHeight: 25 },
  openDay: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  loading: { marginVertical: 24 },
  empty: { fontSize: 14, lineHeight: 21, paddingTop: 12, paddingBottom: 12 },
  timeline: { position: 'relative' },
  line: { position: 'absolute', left: 58, width: 1, top: 24, bottom: 28 },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingTop: 18, paddingBottom: 18 },
  time: { width: 42, fontSize: 12, lineHeight: 22, fontVariant: ['tabular-nums'] },
  nodeColumn: { width: 12, alignItems: 'center', paddingTop: 8 },
  node: { width: 6, height: 6, borderRadius: 3 },
  entryBody: { flex: 1, minWidth: 0 },
  entryTitle: { fontSize: 16, lineHeight: 22 },
  detail: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  review: { fontSize: 11, lineHeight: 17, marginTop: 4 },
  amount: { minWidth: 48, maxWidth: 90, alignItems: 'flex-end' },
  kcal: { fontSize: 18, lineHeight: 24, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 11, lineHeight: 16 },
  status: { minWidth: 28, alignItems: 'flex-end', paddingTop: 2 },
});
