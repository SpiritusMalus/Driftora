import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import type { FoodEntry } from '@/lib/core/db/schema';
import { formatInt } from '@/lib/core/format';
import { shortMealTitle } from '@/lib/core/insights/mealTitle';
import { mealTypeForEntry } from '@/lib/core/insights/mealType';
import { useTheme } from '@/lib/theme/theme';

/** Real journal records, newest first. An absent user photo stays absent. */
export function RecentFoodList({
  entries, photoUris = {}, hideCalories, onOpenEntry, expandedIds,
  renderExpanded, onEdit, onRepeat, onDelete, compact = false,
}: {
  entries: readonly FoodEntry[] | null;
  photoUris?: Readonly<Record<number, string>>;
  hideCalories: boolean;
  onOpenEntry: (entry: FoodEntry) => void;
  expandedIds?: ReadonlySet<number>;
  renderExpanded?: (entry: FoodEntry) => ReactNode;
  onEdit?: (entry: FoodEntry) => void;
  onRepeat?: (entry: FoodEntry) => void;
  onDelete?: (entry: FoodEntry) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeType = fontScale > 1.5;
  const dense = compact && !largeType;
  const ordered = entries == null ? null : [...entries].sort((a, b) => b.ts.getTime() - a.ts.getTime() || b.id - a.id);

  return (
    <View style={[styles.section, dense && styles.sectionCompact]}>
      <View style={[styles.heading, dense && styles.headingCompact]}>
        <Text style={[styles.title, theme.font.bodyMedium, { color: theme.text }]}>{t('home.food.recent')}</Text>
        {ordered != null ? <Text style={[styles.count, theme.font.body, { color: theme.subtle }]}>{t('home.food.entryCount', { count: ordered.length })}</Text> : null}
      </View>
      {ordered == null ? <ActivityIndicator color={theme.primary} style={styles.loading} /> : ordered.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="restaurant-outline" size={28} color={theme.subtle} />
          <Text style={[styles.emptyText, theme.font.body, { color: theme.subtle }]}>{t('food.emptyDay')}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {ordered.map((entry) => {
            const parsing = entry.parseStatus != null;
            const open = expandedIds?.has(entry.id) ?? false;
            const meal = entry.meal ?? mealTypeForEntry(entry.rawText, entry.ts);
            const time = `${String(entry.ts.getHours()).padStart(2, '0')}:${String(entry.ts.getMinutes()).padStart(2, '0')}`;
            return (
              <View key={entry.id} style={[styles.card, { backgroundColor: theme.surface }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={expandedIds ? { expanded: open } : undefined}
                  onPress={() => onOpenEntry(entry)}
                  style={({ pressed }) => [styles.row, dense && styles.rowCompact, largeType && styles.rowLarge, { opacity: pressed ? 0.65 : 1 }]}
                >
                  <FoodPhoto uri={photoUris[entry.id]} source={entry.source} large={largeType} compact={dense} />
                  <View style={styles.copy}>
                    <Text style={[styles.meta, dense && styles.metaCompact, theme.font.body, { color: theme.subtle }]}>{t(`food.meal.${meal}`)} · {time}</Text>
                    <Text numberOfLines={open || largeType ? undefined : 2} style={[styles.mealName, dense && styles.mealNameCompact, theme.font.bodyMedium, { color: theme.text }]}>
                      {parsing ? t(entry.parseStatus === 'pending' ? 'food.bg.parsing' : 'food.bg.failed') : entry.rawText ? open ? entry.rawText : shortMealTitle(entry.rawText) : t('food.untitled')}
                    </Text>
                    {parsing ? (
                      entry.parseStatus === 'pending' ? <ActivityIndicator size="small" color={theme.subtle} style={styles.status} /> : <Ionicons name="refresh-outline" size={21} color={theme.primary} style={styles.status} />
                    ) : (
                      <>
                        {!hideCalories ? <Text style={[styles.kcal, dense && styles.kcalCompact, theme.font.bodyMedium, { color: theme.text }]}>{formatInt(Math.round(entry.kcal))} <Text style={[styles.unit, theme.font.body, { color: theme.subtle }]}>{t('units.kcal')}</Text></Text> : null}
                        <View style={[styles.macros, dense && styles.macrosCompact]}>
                          {[
                            { label: t('macros.protShort'), value: entry.proteinG, color: theme.protein },
                            { label: t('macros.fatShort'), value: entry.fatG, color: theme.fat },
                            { label: t('macros.carbShort'), value: entry.carbG, color: theme.carb },
                          ].map((macro) => <Text key={macro.label} style={[styles.macro, dense && styles.macroCompact, theme.font.body, { color: theme.subtle }]}><Text style={{ color: macro.color }}>{macro.label}</Text> {formatInt(Math.round(macro.value))} {t('units.g')}</Text>)}
                        </View>
                        {!entry.confirmed ? <Text style={[styles.review, theme.font.body, { color: theme.primary }]}>{t('food.bg.review')}</Text> : null}
                      </>
                    )}
                  </View>
                </Pressable>
                {onEdit || onRepeat || onDelete ? (
                  <View style={[styles.actions, { borderTopColor: theme.separator }]}>
                    {!parsing && onEdit ? <EntryAction label={t('food.items.edit')} icon="create-outline" onPress={() => onEdit(entry)} /> : null}
                    {!parsing && onRepeat ? <EntryAction label={t('food.repeat')} icon="repeat-outline" onPress={() => onRepeat(entry)} /> : null}
                    {onDelete ? <EntryAction label={t('food.delete')} icon="trash-outline" onPress={() => onDelete(entry)} /> : null}
                  </View>
                ) : null}
                {open && renderExpanded ? <View style={styles.expanded}>{renderExpanded(entry)}</View> : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

function FoodPhoto({ uri, source, large, compact }: { uri?: string; source: FoodEntry['source']; large: boolean; compact: boolean }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return uri && !failed ? (
    <Image source={{ uri }} style={[styles.photo, compact && styles.photoCompact, large && styles.photoLarge]} resizeMode="cover" accessible={false} onError={() => setFailed(true)} />
  ) : (
    <View accessible={false} style={[styles.photo, compact && styles.photoCompact, styles.photoPlaceholder, large && styles.photoLarge, { backgroundColor: theme.surface2 }]}>
      <Ionicons name={source === 'photo' ? 'image-outline' : source === 'voice' ? 'mic-outline' : 'restaurant-outline'} size={28} color={theme.subtle} />
    </View>
  );
}

function EntryAction({ label, icon, onPress }: { label: string; icon: 'create-outline' | 'repeat-outline' | 'trash-outline'; onPress: () => void }) {
  const theme = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
    <Ionicons name={icon} size={21} color={icon === 'trash-outline' ? theme.subtle : theme.primary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { marginTop: 25, marginBottom: 22 },
  sectionCompact: { marginTop: 16 },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  headingCompact: { marginBottom: 10 },
  title: { fontSize: 20, lineHeight: 28, letterSpacing: -0.4 },
  count: { fontSize: 12, lineHeight: 19 },
  loading: { marginVertical: 24 },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 24, paddingHorizontal: 12 },
  emptyText: { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  list: { gap: 12 },
  card: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 9, gap: 13, minHeight: 100 },
  rowCompact: { padding: 6, gap: 11, minHeight: 88 },
  rowLarge: { alignItems: 'flex-start', gap: 10 },
  photo: { width: 82, height: 92, borderRadius: 10 },
  photoCompact: { width: 74, height: 74 },
  photoLarge: { width: 62, height: 78 },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, paddingRight: 3 },
  meta: { fontSize: 12, lineHeight: 18, marginBottom: 3 },
  metaCompact: { fontSize: 11, lineHeight: 16, marginBottom: 2 },
  mealName: { fontSize: 15, lineHeight: 21, letterSpacing: -0.2 },
  mealNameCompact: { fontSize: 14, lineHeight: 20 },
  kcal: { fontSize: 17, lineHeight: 24, marginTop: 3, fontVariant: ['tabular-nums'] },
  kcalCompact: { fontSize: 16, lineHeight: 22, marginTop: 2 },
  unit: { fontSize: 12, lineHeight: 18 },
  macros: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 },
  macrosCompact: { marginTop: 2, gap: 7 },
  macro: { fontSize: 12, lineHeight: 18, fontVariant: ['tabular-nums'] },
  macroCompact: { fontSize: 11, lineHeight: 16 },
  review: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  status: { alignSelf: 'flex-start', marginTop: 7 },
  actions: { borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8 },
  action: { width: 46, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  expanded: { paddingHorizontal: 14, paddingBottom: 10 },
});
