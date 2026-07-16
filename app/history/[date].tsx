import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { listEntriesForDay } from '@/lib/core/db/food';
import { listMoodsForDay } from '@/lib/core/db/mood';
import type { FoodEntry, MoodRow } from '@/lib/core/db/schema';
import { ensureSettings } from '@/lib/core/db/settings';
import { getStepsRow } from '@/lib/core/db/steps';
import { getWeightForDay } from '@/lib/core/db/weight';
import { formatDayTitle, parseDayKey } from '@/lib/i18n/formatDay';
import { useTheme } from '@/lib/theme/theme';

/// One past day, read-only: the food log (each entry opens its normal edit
/// screen), the mood check-ins, and the body facts (weight, steps) when they
/// exist. Reached from the day-history list behind the «Сегодня ⌄» title.
export default function HistoryDayScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const dayDate = typeof date === 'string' ? parseDayKey(date) : null;

  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [moods, setMoods] = useState<MoodRow[]>([]);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [steps, setSteps] = useState<number | null>(null);
  const [hideCalories, setHideCalories] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        // A malformed day key must land on the honest empty state, not an
        // eternally blank body (loaded would otherwise never flip).
        if (!dayDate || typeof date !== 'string') {
          setLoaded(true);
          return;
        }
        const [settings, dayEntries, dayMoods, weightRow, stepsRow] = await Promise.all([
          ensureSettings(db),
          listEntriesForDay(db, dayDate),
          listMoodsForDay(db, dayDate),
          getWeightForDay(db, date),
          getStepsRow(db, date),
        ]);
        if (!active) return;
        setHideCalories(settings.hideCalories);
        setEntries(dayEntries);
        setMoods(dayMoods);
        setWeightKg(weightRow ? weightRow.weightKg : null);
        setSteps(stepsRow != null ? Number(stepsRow.steps) : null);
        setLoaded(true);
      })();
      return () => {
        active = false;
      };
    }, [db, date, dayDate]),
  );

  const totals = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      prot: acc.prot + e.proteinG,
      fat: acc.fat + e.fatG,
      carb: acc.carb + e.carbG,
    }),
    { kcal: 0, prot: 0, fat: 0, carb: 0 },
  );

  const foodRows: RowSpec[] = entries.map((e) => ({
    key: String(e.id),
    title: e.rawText.trim().length > 0 ? e.rawText : t('food.untitled'),
    subtitle: e.meal ? t(`food.meal.${e.meal}`) : formatTime(new Date(e.ts)),
    right: (
      <Text style={[styles.rowValue, { color: theme.text }, theme.font.bodyMedium]}>
        {hideCalories
          ? `${t('macros.protein')} ${Math.round(e.proteinG)}`
          : `${Math.round(e.kcal)} ${t('units.kcal')}`}
      </Text>
    ),
    onPress: () => router.push(`/food/${e.id}`),
  }));

  const moodRows: RowSpec[] = moods.map((m) => ({
    key: String(m.id),
    title: formatTime(m.ts),
    right: (
      <Text style={[styles.rowValue, { color: theme.text }, theme.font.bodyBold]}>
        {m.value}/10
      </Text>
    ),
  }));

  // Body facts fold into one quiet line («Вес 72.3 кг · Шаги 8 420») instead of
  // a two-row card — they're context, not the day's headline.
  const bodyParts: string[] = [];
  if (weightKg != null)
    bodyParts.push(`${t('history.weightRow')} ${weightKg.toFixed(1)} ${t('weight.unit')}`);
  if (steps != null) bodyParts.push(`${t('history.stepsRow')} ${formatSteps(steps)}`);
  const bodyLine = bodyParts.length > 0 ? bodyParts.join(' · ') : null;

  const hasFood = entries.length > 0;
  const emptyDay = loaded && entries.length === 0 && moods.length === 0 && bodyLine == null;

  return (
    <Screen>
      <Stack.Screen
        options={{ title: typeof date === 'string' ? formatDayTitle(date, t) : t('history.title') }}
      />
      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
          {t('history.dbUnavailable')}
        </Text>
      ) : emptyDay ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
          {t('history.emptyDay')}
        </Text>
      ) : (
        <>
          {hasFood ? (
            <View style={styles.hero}>
              <View style={styles.heroRow}>
                <Text style={[styles.heroNum, { color: theme.heroAccent }, theme.font.heading]}>
                  {hideCalories ? Math.round(totals.prot) : Math.round(totals.kcal)}
                </Text>
                <Text style={[styles.heroUnit, { color: theme.subtle }, theme.font.body]}>
                  {hideCalories ? t('units.g') : t('units.kcal')}
                </Text>
              </View>
              <Text style={[styles.heroSub, { color: theme.subtle }, theme.font.body]}>
                {hideCalories
                  ? t('macros.protein')
                  : t('history.macrosLine', {
                      prot: Math.round(totals.prot),
                      fat: Math.round(totals.fat),
                      carb: Math.round(totals.carb),
                    })}
              </Text>
            </View>
          ) : null}
          {hasFood ? (
            <>
              <SectionHeader>{t('history.foodSection')}</SectionHeader>
              <ListGroup rows={foodRows} />
            </>
          ) : null}
          {moodRows.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader>{t('history.moodSection')}</SectionHeader>
              <ListGroup rows={moodRows} />
            </View>
          ) : null}
          {bodyLine != null ? (
            <View style={styles.section}>
              <SectionHeader>{t('history.otherSection')}</SectionHeader>
              <Text style={[styles.bodyLine, { color: theme.text }, theme.font.bodyMedium]}>
                {bodyLine}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/// Local hh:mm.
function formatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/// Thin-space thousands so "6 240" reads like the steps widget.
function formatSteps(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  // Day headline: kcal (or protein) big in coral, macros riding quietly under —
  // mirrors the «Вес»/«Шаги» heroes from the redesign wave.
  hero: { marginTop: 8, marginBottom: 18 },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  heroNum: { fontSize: 40, lineHeight: 44 },
  heroUnit: { fontSize: 15 },
  heroSub: { fontSize: 13, lineHeight: 18, marginTop: 6, marginHorizontal: 4 },
  section: { marginTop: 18 },
  rowValue: { fontSize: 14 },
  bodyLine: { fontSize: 15, lineHeight: 21, marginHorizontal: 4 },
});
