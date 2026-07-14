import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { useTheme } from '@/lib/theme/theme';

/// Home widget: today's WORKOUTS as ONE calm row, split out from the steps
/// widget («на главный экран добавить тренировки», device feedback 2026-07-12).
/// The subtitle speaks the counted budget share once something is logged, else a
/// plain invitation. Tapping (or the [+]) opens the standalone «Тренировки»
/// screen with the log unfolded — a workout is logged there, never inline (it
/// needs the type/minutes/AI card), so this row is a doorway, not an input.
export function WorkoutWidget({ countedKcal }: { countedKcal: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  const subtitle =
    countedKcal > 0 ? t('home.feeders.workoutsToday', { kcal: countedKcal }) : t('home.feeders.workoutsCta');

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Pressable onPress={() => router.push('/workout')} style={styles.headMain} hitSlop={4}>
          <Ionicons name="barbell-outline" size={18} color={theme.accent} />
          <View style={styles.headText}>
            <Text style={[styles.title, { color: theme.text }, theme.font.bodySemiBold]}>
              {t('home.feeders.workouts')}
            </Text>
            <Text style={[styles.subtitle, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
        <Pressable onPress={() => router.push('/workout')} hitSlop={8}>
          <Ionicons name="chevron-forward" size={16} color={theme.tertiary} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headText: { flex: 1 },
  title: { fontSize: 15 },
  subtitle: { fontSize: 13, marginTop: 1 },
});
