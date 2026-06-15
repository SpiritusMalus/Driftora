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
        </Stack>
      </SafeAreaProvider>
    </DatabaseProvider>
  );
}
