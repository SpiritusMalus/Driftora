import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/lib/i18n';
import { DatabaseProvider } from '@/lib/core/db/DatabaseProvider';
import { colors } from '@/lib/theme/colors';

export default function RootLayout() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;

  return (
    <DatabaseProvider>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.background },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: t('home.title') }} />
          <Stack.Screen name="food/log" options={{ title: t('food.title') }} />
          <Stack.Screen name="weight/index" options={{ title: t('weight.title') }} />
          <Stack.Screen name="diary/index" options={{ title: t('diary.listTitle') }} />
          <Stack.Screen name="diary/new" options={{ title: t('diary.newTitle') }} />
          <Stack.Screen name="diary/[id]" options={{ title: t('diary.entryTitle') }} />
          <Stack.Screen name="wins/index" options={{ title: t('wins.title') }} />
          <Stack.Screen name="settings/index" options={{ title: t('settings.title') }} />
        </Stack>
      </SafeAreaProvider>
    </DatabaseProvider>
  );
}
