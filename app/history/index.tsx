import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { Screen } from '@/components/ui/Screen';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { macroTotalsByDay } from '@/lib/core/db/food';
import { listMoodsSince } from '@/lib/core/db/mood';
import { ensureSettings } from '@/lib/core/db/settings';
import { listStepsDays } from '@/lib/core/db/steps';
import { listWeights } from '@/lib/core/db/weight';
import { formatDayTitle, localDayKey } from '@/lib/i18n/formatDay';
import { useTheme } from '@/lib/theme/theme';

/// How far back the day list reaches. A month of context is what «посмотреть
/// прошлый день» needs; deeper archaeology can wait for a real ask.
const WINDOW_DAYS = 30;

/// The day-history list behind the tappable «Сегодня ⌄» title: the last month
/// of days that HAVE any log (food, mood, weight or steps), newest first —
/// today always shown. Tapping a day opens its read-only log view.
export default function HistoryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();

  const [rows, setRows] = useState<RowSpec[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const now = new Date();
        const windowStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - (WINDOW_DAYS - 1),
        );
        const [settings, foodByDay, moodRows, weightRows, stepsRows] = await Promise.all([
          ensureSettings(db),
          macroTotalsByDay(db, WINDOW_DAYS, now),
          listMoodsSince(db, windowStart),
          listWeights(db),
          listStepsDays(db, WINDOW_DAYS + 2),
        ]);
        if (!active) return;
        // Newest-first check-ins → the first hit per day is that day's latest.
        const moodByDay = new Map<string, number>();
        for (const m of moodRows) {
          const key = localDayKey(new Date(m.ts));
          if (!moodByDay.has(key)) moodByDay.set(key, m.value);
        }
        const weightDays = new Set(weightRows.map((w) => w.date));
        const stepsDays = new Set(stepsRows.map((s) => s.date));

        const specs: RowSpec[] = [];
        for (let i = 0; i < WINDOW_DAYS; i++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          const key = localDayKey(d);
          const food = foodByDay.get(key);
          const mood = moodByDay.get(key);
          const hasAny =
            food != null || mood != null || weightDays.has(key) || stepsDays.has(key);
          // Empty days are skipped (a month of «—» rows is noise), but today
          // always shows — it's the anchor the user came from.
          if (!hasAny && i !== 0) continue;
          specs.push({
            key,
            title: formatDayTitle(key, t, now),
            subtitle: food
              ? settings.hideCalories
                ? `${t('macros.protein')} ${Math.round(food.proteinG)} ${t('units.g')}`
                : `${Math.round(food.kcal)} ${t('units.kcal')} · ${t('macros.protein')} ${Math.round(food.proteinG)} ${t('units.g')}`
              : t('history.noFood'),
            right:
              mood != null ? (
                <Text style={[styles.mood, { color: theme.text }, theme.font.bodyBold]}>
                  {mood}/10
                </Text>
              ) : undefined,
            onPress: () => router.push(`/history/${key}`),
          });
        }
        setRows(specs);
      })();
      return () => {
        active = false;
      };
    }, [db, t, theme, router]),
  );

  return (
    <Screen>
      <Text style={[styles.intro, { color: theme.subtle }, theme.font.body]}>
        {t('history.intro')}
      </Text>
      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
          {t('history.dbUnavailable')}
        </Text>
      ) : rows == null ? null : rows.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
          {t('history.empty')}
        </Text>
      ) : (
        <ListGroup rows={rows} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 14, marginHorizontal: 4 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  mood: { fontSize: 16 },
});
