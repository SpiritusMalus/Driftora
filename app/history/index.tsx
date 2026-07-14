import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

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
        // Actual values, not just presence — the row surfaces steps/weight when
        // there's no food so a movement-only day stops reading as «пусто».
        const stepsByDay = new Map<string, number>();
        for (const s of stepsRows) if (!stepsByDay.has(s.date)) stepsByDay.set(s.date, Number(s.steps));
        const weightByDay = new Map<string, number>();
        for (const w of weightRows) if (!weightByDay.has(w.date)) weightByDay.set(w.date, w.weightKg);

        const specs: RowSpec[] = [];
        for (let i = 0; i < WINDOW_DAYS; i++) {
          const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
          const key = localDayKey(d);
          const food = foodByDay.get(key);
          const mood = moodByDay.get(key);
          const stepsN = stepsByDay.get(key);
          const weightN = weightByDay.get(key);
          const hasAny = food != null || mood != null || weightN != null || stepsN != null;
          // Empty days are skipped (a month of «—» rows is noise), but today
          // always shows — it's the anchor the user came from.
          if (!hasAny && i !== 0) continue;
          // Subtitle honesty: food headline first; otherwise what WAS logged
          // (steps · weight); mood alone rides the pill, so no «noFood» there.
          let subtitle: string | undefined;
          if (food) {
            subtitle = settings.hideCalories
              ? `${t('macros.protein')} ${Math.round(food.proteinG)} ${t('units.g')}`
              : `${Math.round(food.kcal)} ${t('units.kcal')} · ${t('macros.protein')} ${Math.round(food.proteinG)} ${t('units.g')}`;
          } else {
            const parts: string[] = [];
            if (stepsN != null) parts.push(`${formatSteps(stepsN)} ${t('steps.unit')}`);
            if (weightN != null) parts.push(`${weightN.toFixed(1)} ${t('weight.unit')}`);
            subtitle = parts.length > 0 ? parts.join(' · ') : mood != null ? undefined : t('history.noFood');
          }
          specs.push({
            key,
            title: formatDayTitle(key, t, now),
            subtitle,
            // Neutral mood pill — draws the eye when scanning the month without
            // judging the value (coral is a brand accent, never «плохо»).
            right:
              mood != null ? (
                <View style={[styles.moodPill, { backgroundColor: theme.fill }]}>
                  <Text style={[styles.moodPillText, { color: theme.text }, theme.font.bodySemiBold]}>
                    {mood}/10
                  </Text>
                </View>
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

/// Thin-space thousands so "6 240" reads like the steps widget (mirrors [date]).
function formatSteps(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  moodPill: { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3 },
  moodPillText: { fontSize: 13 },
});
