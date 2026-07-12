import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';

import { useTheme } from '@/lib/theme/theme';

/// The header-right «Разделы ›» link into the /more hub. Shared by the two
/// peer day panes — Home (body) and Mood (mind) — so switching focus by swipe
/// never loses the way into the rest of the app.
export function HeaderSectionsLink() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/more')}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => ({
        opacity: pressed ? 0.5 : 1,
        flexDirection: 'row',
        alignItems: 'center',
      })}
    >
      <Text style={[{ color: theme.primary, fontSize: 16, marginRight: 2 }, theme.font.bodySemiBold]}>
        {t('home.moreLink')}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={theme.primary} />
    </Pressable>
  );
}
