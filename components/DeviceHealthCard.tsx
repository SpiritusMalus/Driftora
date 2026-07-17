import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { updateSettings } from '@/lib/core/db/settings';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { useTheme } from '@/lib/theme/theme';

type ConnectState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'denied'
  | 'unavailable'
  | 'update_required'
  | 'unsupported';

/// Health Connect's package on Google Play — install/update deeplink target.
const HEALTH_CONNECT_PKG = 'com.google.android.apps.healthdata';

/// Connect card for the EXTENDED device import (weight/%жира с весов,
/// тренировки с часов, ночные сигналы) — the same state machine as the steps
/// card on «Шаги», but requesting the extended permission scope and flipping
/// the single `healthImportExtended` settings flag. One successful connect on
/// ANY screen lights every extended import; parents hide the card once the
/// flag is on. `onConnected` runs after the flag is saved — screens use it to
/// backfill and refresh their own lists.
export function DeviceHealthCard({
  explainer,
  onConnected,
}: {
  explainer: string;
  onConnected?: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();
  const [state, setState] = useState<ConnectState>('idle');

  async function onConnect() {
    if (!db || state === 'connecting') return;
    setState('connecting');
    try {
      const svc = getHealthService();
      // Probe the provider FIRST — a missing/outdated Health Connect makes the
      // permission request a silent no-op (same lesson as the steps card).
      const avail = svc.availability ? await svc.availability() : 'available';
      if (avail !== 'available') {
        setState(avail);
        return;
      }
      if (!svc.requestExtendedPermissions) {
        setState('unsupported');
        return;
      }
      const granted = await svc.requestExtendedPermissions();
      if (!granted) {
        setState('denied');
        return;
      }
      await updateSettings(db, { healthImportExtended: true });
      await onConnected?.();
      setState('connected');
    } catch {
      setState('unavailable');
    }
  }

  /// Google Play listing for Health Connect (install or update); https fallback.
  async function onOpenStore() {
    const market = `market://details?id=${HEALTH_CONNECT_PKG}`;
    const web = `https://play.google.com/store/apps/details?id=${HEALTH_CONNECT_PKG}`;
    try {
      if (await Linking.canOpenURL(market)) await Linking.openURL(market);
      else await Linking.openURL(web);
    } catch {
      await Linking.openURL(web).catch(() => {});
    }
  }

  if (state === 'connected') {
    return (
      <View style={styles.doneRow}>
        <Ionicons name="checkmark-circle" size={16} color={theme.primary} />
        <Text style={[styles.doneText, { color: theme.subtle }, theme.font.body]}>
          {t('device.connectedNow')}
        </Text>
      </View>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={[styles.explainer, { color: theme.subtle }, theme.font.body]}>{explainer}</Text>
      <PrimaryButton
        label={state === 'connecting' ? t('device.connecting') : t('device.connect')}
        onPress={onConnect}
        disabled={db == null || state === 'connecting'}
        style={styles.btn}
      />
      {state !== 'idle' && state !== 'connecting' ? (
        <Text style={[styles.status, { color: theme.subtle }, theme.font.body]}>
          {t(`device.state.${state}`)}
        </Text>
      ) : null}
      {Platform.OS === 'android' && (state === 'update_required' || state === 'unavailable') ? (
        <Pressable onPress={onOpenStore} hitSlop={8} style={styles.installRow}>
          <Text style={[styles.installLink, { color: theme.primary }, theme.font.bodySemiBold]}>
            {t('device.installAction')}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 4 },
  explainer: { fontSize: 13, lineHeight: 19 },
  btn: { marginTop: 12 },
  status: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  installRow: { marginTop: 10, paddingVertical: 4 },
  installLink: { fontSize: 14, textDecorationLine: 'underline' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  doneText: { fontSize: 13, lineHeight: 19, flex: 1 },
});
