import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/lib/i18n';
import { colors } from '@/lib/theme/colors';

export default function RootLayout() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;

  // Open the encrypted database on launch (device only). Lazy-imported so Jest
  // and web don't pull in the op-sqlite native module.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [{ openDatabase }, { ensureSettings }] = await Promise.all([
          import('@/lib/core/db/client'),
          import('@/lib/core/db/settings'),
        ]);
        const db = await openDatabase();
        await ensureSettings(db);
      } catch (e) {
        if (!cancelled) console.warn('DB init failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="index" options={{ title: t('home.title') }} />
      </Stack>
    </SafeAreaProvider>
  );
}
