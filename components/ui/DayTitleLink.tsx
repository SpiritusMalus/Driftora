import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// Tappable header title «Сегодня ⌄» → the day-history list («выбрать прошлый
/// день и посмотреть логи еды и настроения»). Replaces the static native title
/// on the two day panes; styled to match each platform's header type. Note:
/// a custom headerTitle opts the screen out of the iOS large-title look — the
/// tap affordance wins over the flourish.
export function DayTitleLink({ label }: { label: string }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/history')}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => ({
        opacity: pressed ? 0.5 : 1,
        flexDirection: 'row',
        alignItems: 'center',
      })}
    >
      <Text
        numberOfLines={1}
        style={
          theme.isIOS
            ? { color: theme.text, fontSize: 17, fontWeight: '600' }
            : { color: theme.text, fontSize: 20, fontFamily: 'GolosText_600SemiBold' }
        }
      >
        {label}
      </Text>
      <Ionicons
        name="chevron-down"
        size={theme.isIOS ? 14 : 16}
        color={theme.subtle}
        style={{ marginLeft: 4, marginTop: 2 }}
      />
    </Pressable>
  );
}
