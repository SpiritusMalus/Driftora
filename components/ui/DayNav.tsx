import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { formatDayTitle, localDayKey, shiftDayKey } from '@/lib/i18n/formatDay';
import { useTheme } from '@/lib/theme/theme';

/// How far back a day pane lets you walk. A month is what «посмотреть прошлый
/// день» needs — the same horizon the day-history list uses — and a bounded
/// range keeps the arrows from reading as an infinite archive.
export const DAY_NAV_BACK_DAYS = 30;

/// «‹ Сегодня ›» — the day a screen is showing AND writing to. One steel track
/// with the two arrows inside, matching the workout card's mode switcher rather
/// than inventing a third control shape.
///
/// Forward stops at today: a workout you haven't done yet isn't a log entry, and
/// a budget for tomorrow isn't a thing this app has. The label itself is the way
/// back — tapping it returns to today from wherever you wandered, so nobody has
/// to press ‹ eleven times.
export function DayNav({
  value,
  onChange,
  backDays = DAY_NAV_BACK_DAYS,
  style,
}: {
  /// The selected day as a 'YYYY-MM-DD' key.
  value: string;
  onChange: (day: string) => void;
  backDays?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  const today = localDayKey(new Date());
  const isToday = value === today;
  // Day keys are ISO, so a plain string compare IS a date compare.
  const canPrev = value > shiftDayKey(today, -backDays);

  return (
    <View style={[styles.row, { backgroundColor: theme.iconBg }, style]}>
      <Pressable
        onPress={() => onChange(shiftDayKey(value, -1))}
        disabled={!canPrev}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canPrev }}
        accessibilityLabel={t('history.prevDay')}
        style={({ pressed }) => [styles.arrow, { opacity: !canPrev ? 0.3 : pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="chevron-back" size={18} color={theme.text} />
      </Pressable>
      <Pressable
        onPress={() => onChange(today)}
        disabled={isToday}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={isToday ? formatDayTitle(value, t) : t('history.backToToday')}
        style={({ pressed }) => [styles.label, { opacity: pressed && !isToday ? 0.6 : 1 }]}
      >
        <Text numberOfLines={1} style={[styles.labelText, { color: theme.text }, theme.font.bodySemiBold]}>
          {formatDayTitle(value, t)}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange(shiftDayKey(value, 1))}
        disabled={isToday}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ disabled: isToday }}
        accessibilityLabel={t('history.nextDay')}
        style={({ pressed }) => [styles.arrow, { opacity: isToday ? 0.3 : pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="chevron-forward" size={18} color={theme.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 3 },
  arrow: { width: 40, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  label: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 },
  labelText: { fontSize: 14 },
});
