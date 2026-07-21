import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { useTheme } from '@/lib/theme/theme';

/// First-run onboarding gate (B1) — a short, calm intro shown ONCE after the
/// legal gate: what the Body↔Mind hero is, the privacy promise, and the one-tap
/// way to feed it. Modelled on `LegalGate`: it wraps the app, resolves a
/// persisted `onboarding_seen` flag, and never blocks returning users.
///
/// Degradation: with no database (web / Expo Go) there's nothing to persist, so
/// we don't trap the user — content shows. On a real build the flag is set on
/// dismiss and the intro never returns.
// Two slides: the value prop, then how to feed it in a tap. The privacy slide
// was cut — its promise already leads the LegalGate one screen earlier, and its
// backup nudge is premature on a fresh, data-empty install (it lives in
// Settings, where there is something to back up).
const SLIDES = [
  { icon: 'pulse-outline', key: 'hero' },
  { icon: 'hand-left-outline', key: 'feed' },
] as const;

export function Onboarding({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // null = still resolving; true/false = whether the intro must show.
  const [show, setShow] = useState<boolean | null>(null);
  const [index, setIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) {
        if (active) setShow(false); // no persistence — don't trap the user
        return;
      }
      const s = await ensureSettings(db);
      if (active) setShow(!s.onboardingSeen);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  const finish = useCallback(async () => {
    setFinishing(true);
    try {
      // The handoff after the intro: a fresh install (no body profile yet) goes
      // STRAIGHT into the body-setup wizard — the «а что дальше?» moment — while
      // a returning profile lands on Home untouched. The push is deferred a tick
      // so the Stack below has mounted by the time we navigate.
      let needsSetup = false;
      if (db) {
        const s = await updateSettings(db, { onboardingSeen: true });
        needsSetup = !((s.sex === 'male' || s.sex === 'female') && s.heightCm >= 100 && s.heightCm <= 250);
      }
      setShow(false);
      if (needsSetup) setTimeout(() => router.push('/body-setup'), 0);
    } finally {
      setFinishing(false);
    }
  }, [db]);

  // While resolving, hold a calm background (brief) — same idea as LegalGate.
  if (show === null) {
    return <View style={[styles.fill, { backgroundColor: theme.background }]} />;
  }
  if (!show) return <>{children}</>;

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor: theme.background,
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.body}>
        <View style={[styles.iconTile, { backgroundColor: theme.primarySoft }]}>
          <Ionicons name={slide.icon} size={34} color={theme.primary} />
        </View>
        <Text style={[styles.title, { color: theme.text }, theme.font.heading]}>
          {t(`onboarding.${slide.key}.title`)}
        </Text>
        <Text style={[styles.lead, { color: theme.subtle }, theme.font.body]}>
          {t(`onboarding.${slide.key}.body`)}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.key}
              style={[
                styles.dot,
                { backgroundColor: i === index ? theme.primary : theme.separator },
              ]}
            />
          ))}
        </View>
        <PrimaryButton
          label={isLast ? t('onboarding.start') : t('onboarding.next')}
          onPress={() => (isLast ? void finish() : setIndex((i) => i + 1))}
          disabled={finishing}
          style={styles.cta}
        />
        {!isLast ? (
          <Pressable onPress={() => void finish()} hitSlop={8} accessibilityRole="button">
            <Text style={[styles.skip, { color: theme.subtle }, theme.font.body]}>
              {t('onboarding.skip')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 26, justifyContent: 'space-between' },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  iconTile: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  title: { fontSize: 25, lineHeight: 31, textAlign: 'center', marginBottom: 14 },
  lead: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  footer: { gap: 18, alignItems: 'center' },
  cta: { alignSelf: 'stretch' },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  skip: { fontSize: 14, paddingVertical: 4 },
});
