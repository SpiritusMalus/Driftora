import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listEntriesForDay } from '@/lib/core/db/food';
import { groupEntriesByMeal } from '@/lib/core/insights/mealType';
import type { FoodEntry } from '@/lib/core/db/schema';
import { useTheme } from '@/lib/theme/theme';

/// Today's logged food, newest first. Lands here after a save (so the entry is
/// visibly there, not lost to a back-to-Home), and each row opens the
/// view/edit/delete detail. The button adds a new entry via the log screen.
export default function FoodDayScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const [entries, setEntries] = useState<FoodEntry[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listEntriesForDay(db);
        if (active) setEntries(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  return (
    <Screen>
      <PrimaryButton label={t('food.add')} onPress={() => router.push('/food/log')} style={styles.add} />

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.dbUnavailable')}</Text>
      ) : entries == null ? null : entries.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.emptyDay')}</Text>
      ) : (
        <View style={styles.list}>
          {groupEntriesByMeal(entries).map((group) => (
            <View key={group.type} style={styles.group}>
              <Text style={[styles.mealHead, { color: theme.subtle }, theme.font.bodySemiBold]}>
                {t(`food.meal.${group.type}`)}
              </Text>
              {group.entries.map((e) => (
                <Card key={e.id} style={styles.row} onPress={() => router.push(`/food/${e.id}`)}>
                  <View style={styles.rowHead}>
                    <Text style={[styles.rowText, { color: theme.text }, theme.font.bodySemiBold]} numberOfLines={1}>
                      {e.rawText || t('food.untitled')}
                    </Text>
                    <Text style={[styles.rowTime, { color: theme.subtle }, theme.font.body]}>{formatTime(e.ts)}</Text>
                  </View>
                  <Text style={[styles.rowMacros, { color: theme.subtle }, theme.font.body]}>
                    {Math.round(e.kcal)} {t('units.kcal')} · {t('macros.protein')} {Math.round(e.proteinG)}{' '}
                    {t('units.g')} · {t('macros.fat')} {Math.round(e.fatG)} {t('units.g')} · {t('macros.carbs')}{' '}
                    {Math.round(e.carbG)} {t('units.g')}
                  </Text>
                </Card>
              ))}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  add: { marginTop: 4, marginBottom: 12 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { gap: 22 },
  group: { gap: 10 },
  mealHead: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  row: {},
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowText: { fontSize: 15, flex: 1 },
  rowTime: { fontSize: 12 },
  rowMacros: { fontSize: 13, marginTop: 4, lineHeight: 19 },
});
