import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { acceptLegal, needsLegalGate } from '@/lib/core/consent/consent';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { ensureSettings } from '@/lib/core/db/settings';
import type { LegalDoc } from '@/lib/legal/documents';
import { LEGAL_URL } from '@/lib/legal/links';
import { useTheme } from '@/lib/theme/theme';

import { LegalReader } from './LegalReader';

/// First-launch BLOCKING offer gate (TASK §A): the app content is wrapped by
/// this; until the user accepts the Terms + Privacy at the current LEGAL_VERSION
/// they see only the offer (each document opens an in-app reader). Acceptance is
/// persisted and the gate re-shows on a version bump.
///
/// This is GENERAL consent to use the app — deliberately NOT the cross-border
/// AI consent (that is opt-in, captured separately just-in-time / in Settings).
///
/// Degradation: if the database is unavailable (e.g. web / Expo Go without the
/// native module) there is nothing to persist to, so we don't trap the user
/// behind an un-acceptable gate — content is shown. On a real build the DB is
/// present and the gate blocks as intended.
export function LegalGate({ children }: { children: ReactNode }) {
  const db = useDatabase();
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // null = still resolving; true/false = whether the gate must block.
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [reader, setReader] = useState<LegalDoc | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) {
        // No persistence layer — let the app run (offline-only contexts).
        if (active) setBlocked(false);
        return;
      }
      const s = await ensureSettings(db);
      if (active) setBlocked(needsLegalGate(s));
    })();
    return () => {
      active = false;
    };
  }, [db]);

  const onAccept = useCallback(async () => {
    if (!db) return;
    setAccepting(true);
    try {
      await acceptLegal(db);
      setBlocked(false);
    } finally {
      setAccepting(false);
    }
  }, [db]);

  // While resolving, render nothing over the app's own splash (brief).
  if (blocked === null) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    );
  }

  if (!blocked) return <>{children}</>;

  return (
    <View style={[styles.fill, { backgroundColor: theme.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.body}>
        {/* Hero — the privacy promise, promoted out of a 15px body block to the
            heroText+heroAccent idiom used across Settings/Backup (#148/#149). */}
        <View style={styles.hero}>
          <Text style={[styles.heroLine, { color: theme.heroText }, theme.font.heading]}>{t('legal.gate.heroText')}</Text>
          <Text style={[styles.heroLine, { color: theme.heroAccent }, theme.font.heading]}>{t('legal.gate.heroLead')}</Text>
        </View>
        <Text style={[styles.lead, { color: theme.subtle }, theme.font.body]}>{t('legal.gate.body')}</Text>

        <View style={styles.links}>
          <DocRow label={t('legal.terms')} onPress={() => setReader('terms')} theme={theme} />
          <DocRow label={t('legal.privacy')} onPress={() => setReader('privacy')} theme={theme} />
        </View>

        <Pressable
          onPress={() => void Linking.openURL(LEGAL_URL.combined)}
          accessibilityRole="link"
          hitSlop={8}
        >
          <Text style={[styles.online, { color: theme.primary }, theme.font.body]}>{t('legal.viewOnline')}</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('legal.gate.acceptHint')}</Text>
        <PrimaryButton label={t('legal.gate.accept')} onPress={onAccept} disabled={accepting} />
      </View>

      <LegalReader doc={reader} visible={reader != null} onClose={() => setReader(null)} />
    </View>
  );
}

function DocRow({ label, onPress, theme }: { label: string; onPress: () => void; theme: ReturnType<typeof useTheme> }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.docRow,
        { backgroundColor: theme.card, borderColor: theme.separator, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.docLabel, { color: theme.text }, theme.font.bodySemiBold]}>{label}</Text>
      <Text style={[styles.chevron, { color: theme.primary }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, paddingHorizontal: 22, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, justifyContent: 'center' },
  hero: { marginBottom: 14 },
  heroLine: { fontSize: 22, lineHeight: 29 },
  lead: { fontSize: 13, lineHeight: 20, marginBottom: 24 },
  links: { gap: 10 },
  online: { fontSize: 13, textAlign: 'center', marginTop: 14, textDecorationLine: 'underline' },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  docLabel: { fontSize: 15, flex: 1, paddingRight: 12 },
  chevron: { fontSize: 22, lineHeight: 24 },
  footer: { gap: 14 },
  hint: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
