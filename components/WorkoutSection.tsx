import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import type { WorkoutRow } from '@/lib/core/db/schema';
import { latestWeight } from '@/lib/core/db/weight';
import { addWorkout, deleteWorkout, listWorkoutsForDay } from '@/lib/core/db/workouts';
import { EATBACK_FRACTION, WORKOUT_TYPES, type WorkoutType } from '@/lib/core/insights/bodyMetrics';
import { type Theme, useTheme } from '@/lib/theme/theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/// «Тренировки сегодня» — log a workout (type + minutes → kcal via MET, computed
/// from the latest weight) and see the day's burn. Reports the RAW burned kcal up
/// to the parent so the food day can show the eat-back-adjusted target (hybrid).
/// Collapsed by default; never nags — purely additive to the day.
export function WorkoutSection({ db, onChange }: { db: Db; onChange?: (rawKcal: number) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [rows, setRows] = useState<WorkoutRow[]>([]);
  const [weightKg, setWeightKg] = useState(70);
  const [type, setType] = useState<WorkoutType>('walk');
  const [minutes, setMinutes] = useState('');
  const [open, setOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!db) return;
    const [list, w] = await Promise.all([listWorkoutsForDay(db), latestWeight(db)]);
    setRows(list);
    if (w && w.weightKg > 0) setWeightKg(w.weightKg);
    onChange?.(list.reduce((s, r) => s + Number(r.kcal), 0));
  }, [db, onChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add() {
    const min = Number(minutes.replace(',', '.'));
    if (!db || !Number.isFinite(min) || min <= 0) return;
    await addWorkout(db, type, min, weightKg);
    setMinutes('');
    await reload();
  }

  async function remove(id: number) {
    if (!db) return;
    await deleteWorkout(db, id);
    await reload();
  }

  const totalRaw = rows.reduce((s, r) => s + Number(r.kcal), 0);
  const counted = Math.round(totalRaw * EATBACK_FRACTION);

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.head} hitSlop={6}>
        <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>{t('workouts.title')}</Text>
        <Text style={[styles.summary, { color: theme.subtle }, theme.font.body]}>
          {totalRaw > 0 ? t('workouts.summary', { kcal: Math.round(totalRaw), counted }) : t('workouts.summaryEmpty')}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={theme.tertiary} />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          <View style={styles.chips}>
            {WORKOUT_TYPES.map((w) => {
              const active = type === w;
              return (
                <Pressable
                  key={w}
                  onPress={() => setType(w)}
                  style={({ pressed }) => [
                    styles.chip,
                    {
                      backgroundColor: active ? theme.primary : theme.card,
                      borderColor: active ? theme.primary : theme.separator,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                    {t(`workouts.type.${w}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.addRow}>
            <TextField
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="numeric"
              placeholder={t('workouts.minutes')}
              style={styles.minInput}
            />
            <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('workouts.min')}</Text>
            <Pressable
              onPress={() => void add()}
              accessibilityRole="button"
              accessibilityLabel={t('workouts.add')}
              style={({ pressed }) => [styles.addBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.addBtnText, { color: theme.onPrimary }, theme.font.bodySemiBold]}>
                {t('workouts.add')}
              </Text>
            </Pressable>
          </View>

          {rows.length > 0 ? (
            <View style={styles.list}>
              {rows.map((r) => (
                <View key={r.id} style={styles.item}>
                  <Text style={[styles.itemName, { color: theme.text }, theme.font.body]} numberOfLines={1}>
                    {t(`workouts.type.${r.type}`)} · {r.minutes} {t('workouts.min')}
                  </Text>
                  <Text style={[styles.itemKcal, { color: theme.subtle }, theme.font.body]}>
                    {Math.round(r.kcal)} {t('units.kcal')}
                  </Text>
                  <Pressable
                    onPress={() => void remove(r.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('workouts.remove')}
                  >
                    <Ionicons name="close" size={16} color={theme.tertiary} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('workouts.note')}</Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 15 },
  summary: { fontSize: 13, flex: 1, textAlign: 'right' },
  body: { marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  minInput: { width: 90 },
  unit: { fontSize: 13 },
  addBtn: { marginLeft: 'auto', paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  addBtnText: { fontSize: 14 },
  list: { marginTop: 12, gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemName: { fontSize: 13, flex: 1 },
  itemKcal: { fontSize: 13 },
  note: { fontSize: 12, marginTop: 12, lineHeight: 17 },
});
