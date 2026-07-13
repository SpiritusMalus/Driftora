import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { Platform, useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/lib/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LegalGate } from '@/components/legal/LegalGate';
import { Onboarding } from '@/components/Onboarding';
import { DatabaseProvider } from '@/lib/core/db/DatabaseProvider';
import { resolveTheme } from '@/lib/theme/theme';
import { fontAssets } from '@/lib/theme/typography';

/// Two platform looks from the Ember handoff:
///   • iOS — native large titles on a liquid-glass (blurred) header, SF system
///     type. The grouped screens scroll under the translucent bar.
///   • Android — a flat Material app bar tinted to the warm Ember cream, with a
///     left-aligned Unbounded title and no shadow.
/// Both keep the native header so back navigation comes for free.
export default function RootLayout() {
  const { t } = useTranslation();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = resolveTheme(scheme);
  const [fontsLoaded] = useFonts(fontAssets);

  // Hold the first frame until the Ember fonts are ready so Android headers and
  // the hero don't flash in the system face before swapping. (iOS uses SF, so
  // this only matters for Android, but a single gate keeps it simple.)
  if (!fontsLoaded) return null;

  const headerOptions =
    Platform.OS === 'ios'
      ? {
          headerLargeTitle: true,
          headerTransparent: true,
          headerBlurEffect: (scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterial') as
            | 'systemChromeMaterialDark'
            | 'systemChromeMaterial',
          headerLargeTitleShadowVisible: false,
          headerShadowVisible: false,
          headerTintColor: theme.primary,
          headerLargeTitleStyle: { color: theme.text },
          headerTitleStyle: { color: theme.text },
          contentStyle: { backgroundColor: theme.background },
        }
      : {
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: 'Unbounded_600SemiBold', fontSize: 20, color: theme.text },
          contentStyle: { backgroundColor: theme.background },
        };

  return (
    <ErrorBoundary
      colors={{
        background: theme.background,
        text: theme.text,
        subtle: theme.subtle,
        primary: theme.primary,
        onPrimary: theme.onPrimary,
      }}
    >
    <DatabaseProvider>
      <SafeAreaProvider>
        {/* The app never set a status-bar style, so Android release builds kept
            LIGHT system icons over the light cream background — clock/battery
            were unreadable (device feedback 2026-07-10). `auto` binds the icon
            color to the color scheme, matching the theme in both variants. */}
        <StatusBar style="auto" />
        <LegalGate>
        <Onboarding>
        <Stack screenOptions={headerOptions}>
          <Stack.Screen name="index" options={{ title: t('home.title') }} />
          {/* Day history behind the tappable «Сегодня ⌄» title (both day panes). */}
          <Stack.Screen name="history/index" options={{ title: t('history.title') }} />
          <Stack.Screen name="history/[date]" options={{ title: t('history.title') }} />
          <Stack.Screen name="more/index" options={{ title: t('more.title') }} />
          <Stack.Screen name="more/how-it-works" options={{ title: t('howItWorks.title') }} />
          <Stack.Screen name="food/index" options={{ title: t('food.todayTitle') }} />
          <Stack.Screen name="food/log" options={{ title: t('food.title') }} />
          <Stack.Screen name="food/[id]" options={{ title: t('food.entryTitle') }} />
          <Stack.Screen name="weight/index" options={{ title: t('weight.title') }} />
          <Stack.Screen name="body-setup" options={{ title: t('bodySetup.title') }} />
          <Stack.Screen name="activity/index" options={{ title: t('activity.title') }} />
          <Stack.Screen name="workout/index" options={{ title: t('workouts.screenTitle') }} />
          {/* Mood opens by a LEFT SWIPE on Home — slide-from-right on both
              platforms so the screen visually follows the finger's direction. */}
          <Stack.Screen
            name="mood/index"
            options={{ title: t('mood.title'), animation: 'slide_from_right' }}
          />
          <Stack.Screen name="diary/index" options={{ title: t('diary.listTitle') }} />
          <Stack.Screen name="diary/new" options={{ title: t('diary.newTitle') }} />
          <Stack.Screen name="diary/[id]" options={{ title: t('diary.entryTitle') }} />
          <Stack.Screen name="wins/index" options={{ title: t('wins.title') }} />
          <Stack.Screen name="settings/index" options={{ title: t('settings.title') }} />
          <Stack.Screen name="settings/backup" options={{ title: t('backup.title') }} />
          <Stack.Screen name="review/index" options={{ title: t('review.title') }} />
        </Stack>
        </Onboarding>
        </LegalGate>
      </SafeAreaProvider>
    </DatabaseProvider>
    </ErrorBoundary>
  );
}
