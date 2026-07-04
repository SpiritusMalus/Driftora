import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listEntriesForDay, repeatFoodEntry, todayMacroTotals } from '@/lib/core/db/food';
import { ensureSettings } from '@/lib/core/db/settings';
import { groupEntriesByMeal } from '@/lib/core/insights/mealType';
import type { FoodEntry } from '@/lib/core/db/schema';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The user's daily КБЖУ goal, shown only when it was DELIBERATELY set (the
/// untouched 2000/120/70/200 defaults are not a goal) and the app isn't paused.
interface DayGoal {
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
  hideCalories: boolean;
}

/// Today's logged food, newest first. Lands here after a save (so the entry is
/// visibly there, not lost to a back-to-Home), and each row opens the
/// view/edit/delete detail. The button adds a new entry via the log screen;
/// the ↻ on a row re-logs that meal right now (numbers were confirmed once).
export default function FoodDayScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const [entries, setEntries] = useState<FoodEntry[] | null>(null);
  const [totals, setTotals] = useState<{ kcal: number; proteinG: number; fatG: number; carbG: number } | null>(null);
  const [goal, setGoal] = useState<DayGoal | null>(null);
  // «Добавлено ещё раз ✓» after a one-tap repeat; cleared after a moment.
  const [repeatAck, setRepeatAck] = useState<string | null>(null);
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (ackTimer.current) clearTimeout(ackTimer.current);
    },
    [],
  );

  const reload = useCallback(async () => {
    if (!db) return;
    const [list, tot, settings] = await Promise.all([listEntriesForDay(db), todayMacroTotals(db), ensureSettings(db)]);
    setEntries(list);
    setTotals(tot);
    // The progress card needs a deliberate goal AND an unpaused app — otherwise
    // it would pressure with an arbitrary default, which this app never does.
    setGoal(
      settings.targetsSetAt != null && !settings.paused && settings.targetKcal > 0
        ? {
            kcal: settings.targetKcal,
            prot: settings.targetProteinG,
            fat: settings.targetFatG,
            carb: settings.targetCarbG,
            hideCalories: settings.hideCalories,
          }
        : null,
    );
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!active) return;
        await reload();
      })();
      return () => {
        active = false;
      };
    }, [reload]),
  );

  async function onRepeat(id: number) {
    if (!db) return;
    const newId = await repeatFoodEntry(db, id);
    if (newId == null) return;
    await reload();
    setRepeatAck(t('food.repeated'));
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(() => setRepeatAck(null), 2500);
  }

  return (
    <Screen>
      <PrimaryButton label={t('food.add')} onPress={() => router.push('/food/log')} style={styles.add} />
      {repeatAck ? (
        <Text style={[styles.repeatAck, { color: theme.accent }, theme.font.bodyMedium]}>{repeatAck}</Text>
      ) : null}

      {goal != null && totals != null ? <DayProgress goal={goal} totals={totals} theme={theme} /> : null}

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
                    <Pressable
                      onPress={() => void onRepeat(e.id)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={t('food.repeat')}
                      style={({ pressed }) => [styles.repeatBtn, { opacity: pressed ? 0.5 : 1 }]}
                    >
                      <Ionicons name="repeat-outline" size={18} color={theme.primary} />
                    </Pressable>
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

/// The day against the deliberately-set goal. Calm by design: an amber
/// «в плане ✓» when under, a neutral sentence when over — never red, and no
/// kcal row at all under «спрятать калории».
function DayProgress({
  goal,
  totals,
  theme,
}: {
  goal: DayGoal;
  totals: { kcal: number; proteinG: number; fatG: number; carbG: number };
  theme: Theme;
}) {
  const { t } = useTranslation();
  const kcalEaten = Math.round(totals.kcal);
  const onPlan = kcalEaten <= goal.kcal;
  const macros = [
    { label: t('macros.protein'), eaten: Math.round(totals.proteinG), target: goal.prot },
    { label: t('macros.fat'), eaten: Math.round(totals.fatG), target: goal.fat },
    { label: t('macros.carbs'), eaten: Math.round(totals.carbG), target: goal.carb },
  ];
  return (
    <Card style={styles.dayCard}>
      <View style={styles.dayHead}>
        <Text style={[styles.dayTitle, { color: theme.text }, theme.font.bodySemiBold]}>{t('food.day.title')}</Text>
        {goal.hideCalories ? null : onPlan ? (
          <Text style={[styles.dayChip, { color: theme.accent }, theme.font.bodyMedium]}>{t('food.day.onPlan')}</Text>
        ) : (
          <Text style={[styles.dayChip, { color: theme.subtle }, theme.font.body]}>{t('food.day.over')}</Text>
        )}
      </View>
      {goal.hideCalories ? null : (
        <>
          <Text style={[styles.dayKcal, { color: theme.text }, theme.font.bodyMedium]}>
            {t('food.day.kcal', { eaten: kcalEaten, target: goal.kcal })}
          </Text>
          <Bar value={kcalEaten} max={goal.kcal} color={theme.primary} track={theme.fill} height={8} />
        </>
      )}
      <View style={styles.macroRow}>
        {macros.map((m) => (
          <View key={m.label} style={styles.macroCol}>
            <Text style={[styles.macroLabel, { color: theme.subtle }, theme.font.body]}>
              {m.label} {m.eaten}/{m.target}
            </Text>
            <Bar value={m.eaten} max={m.target} color={theme.accent} track={theme.fill} height={5} />
          </View>
        ))}
      </View>
    </Card>
  );
}

function Bar({
  value,
  max,
  color,
  track,
  height,
}: {
  value: number;
  max: number;
  color: string;
  track: string;
  height: number;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <View style={[styles.barTrack, { backgroundColor: track, height, borderRadius: height / 2 }]}>
      <View style={{ width: `${pct}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const styles = StyleSheet.create({
  add: { marginTop: 4, marginBottom: 12 },
  repeatAck: { fontSize: 13, textAlign: 'center', marginBottom: 10 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  list: { gap: 22 },
  group: { gap: 10 },
  mealHead: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  row: {},
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowText: { fontSize: 15, flex: 1 },
  rowTime: { fontSize: 12 },
  repeatBtn: { marginLeft: 2 },
  rowMacros: { fontSize: 13, marginTop: 4, lineHeight: 19 },
  dayCard: { marginBottom: 16 },
  dayHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dayTitle: { fontSize: 15 },
  dayChip: { fontSize: 12 },
  dayKcal: { fontSize: 14, marginBottom: 6 },
  macroRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  macroCol: { flex: 1 },
  macroLabel: { fontSize: 11, marginBottom: 4 },
  barTrack: { overflow: 'hidden', width: '100%' },
});
