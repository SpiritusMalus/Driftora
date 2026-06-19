import { Paths, File } from 'expo-file-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { decryptBlob, encryptBlob } from '@/lib/core/crypto/e2ee';
import { exportAllTables, importAllTables, type BackupDocument } from '@/lib/core/db/backup';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { getOrCreateMasterKeyPair } from '@/lib/core/db/keystore';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// "Резервная копия" — Phase-1 local encrypted backup & restore (no server).
///
/// Backup:  exportAllTables → JSON → encryptBlob(masterPublicKey) → write a file
///          → OS share-sheet, so the user saves it to THEIR OWN cloud (iCloud
///          Drive / Files / Google Drive). The blob is encrypted to the device's
///          X25519 master key, which never leaves expo-secure-store.
/// Restore: pick a file → decryptBlob(masterPrivateKey) → importAllTables
///          (replace-all). Local SQLite stays the source of truth.
///
/// This screen is the thin native glue (file IO + share/pick). All crypto and
/// DB logic lives in `lib/core/crypto/e2ee.ts` + `lib/core/db/backup.ts`, which
/// are unit-tested in node.
///
/// Phase-2 seams (NOT implemented here): a biometric prompt before reading the
/// key; same-ecosystem "no phrase needed" restore via platform key custody; and
/// a recovery phrase / key-file fallback. See `keystore.getOrCreateMasterKeyPair`.
type Status =
  | { kind: 'idle' }
  | { kind: 'working'; op: 'backup' | 'restore' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const BACKUP_EXTENSION = 'hrbackup';

export default function BackupScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const working = status.kind === 'working';

  async function onBackup() {
    if (!db || working) return;
    setStatus({ kind: 'working', op: 'backup' });
    try {
      const doc = await exportAllTables(db);
      const json = JSON.stringify(doc);
      const bytes = new TextEncoder().encode(json);

      const { publicKey } = await getOrCreateMasterKeyPair();
      const blob = encryptBlob(bytes, publicKey);

      // Write the encrypted blob to a cache file, then hand it to the OS
      // share-sheet so the user picks where it goes (their cloud, not ours).
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const file = new File(Paths.cache, `healthroutine-backup-${stamp}.${BACKUP_EXTENSION}`);
      file.create({ overwrite: true });
      file.write(blob);

      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/octet-stream',
          dialogTitle: t('backup.shareTitle'),
        });
        setStatus({ kind: 'done', message: t('backup.backupDone') });
      } else {
        // No share-sheet (e.g. some emulators) — the file still exists locally.
        setStatus({ kind: 'done', message: t('backup.savedLocally', { path: file.uri }) });
      }
    } catch (e) {
      setStatus({ kind: 'error', message: messageFrom(e, t('backup.backupError')) });
    }
  }

  async function onRestore() {
    if (!db || working) return;
    setStatus({ kind: 'working', op: 'restore' });
    try {
      const DocumentPicker = await import('expo-document-picker');
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) {
        setStatus({ kind: 'idle' });
        return;
      }

      const file = new File(picked.assets[0].uri);
      const blob = await file.bytes();

      const { privateKey } = await getOrCreateMasterKeyPair();
      let doc: BackupDocument;
      try {
        const plaintext = decryptBlob(blob, privateKey);
        doc = JSON.parse(new TextDecoder().decode(plaintext)) as BackupDocument;
      } catch {
        // Either the wrong key (a backup from another device/key) or a corrupt /
        // non-backup file. Be honest about the limit.
        setStatus({ kind: 'error', message: t('backup.restoreWrongKey') });
        return;
      }

      await importAllTables(db, doc);
      setStatus({ kind: 'done', message: t('backup.restoreDone') });
    } catch (e) {
      setStatus({ kind: 'error', message: messageFrom(e, t('backup.restoreError')) });
    }
  }

  return (
    <Screen>
      {db == null ? (
        <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>
          {t('backup.dbUnavailable')}
        </Text>
      ) : null}

      <Text style={[styles.intro, { color: theme.text }, theme.font.body]}>{t('backup.intro')}</Text>

      <SectionHeader>{t('backup.backupTitle')}</SectionHeader>
      <Note theme={theme}>{t('backup.backupExplainer')}</Note>
      <PrimaryButton
        label={status.kind === 'working' && status.op === 'backup' ? t('backup.working') : t('backup.backupCta')}
        onPress={onBackup}
        disabled={db == null || working}
        style={styles.btn}
      />

      <SectionHeader>{t('backup.restoreTitle')}</SectionHeader>
      <Note theme={theme}>{t('backup.restoreExplainer')}</Note>
      <Note theme={theme}>{t('backup.restoreReplaceWarning')}</Note>
      <PrimaryButton
        label={status.kind === 'working' && status.op === 'restore' ? t('backup.working') : t('backup.restoreCta')}
        onPress={onRestore}
        disabled={db == null || working}
        style={styles.btn}
      />

      {working ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={theme.primary} />
        </View>
      ) : null}
      {status.kind === 'done' ? (
        <Card style={styles.statusCard} padded={false}>
          <Text style={[styles.statusText, { color: theme.text }, theme.font.body]}>
            {'✓ ' + status.message}
          </Text>
        </Card>
      ) : null}
      {status.kind === 'error' ? (
        <Card style={styles.statusCard} padded={false}>
          <Text style={[styles.statusText, { color: theme.primary }, theme.font.body]}>
            {status.message}
          </Text>
        </Card>
      ) : null}

      <SectionHeader>{t('backup.safetyTitle')}</SectionHeader>
      <Note theme={theme}>{t('backup.safetyNote')}</Note>
    </Screen>
  );
}

function Note({ children, theme }: { children: string; theme: Theme }) {
  return <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{children}</Text>;
}

function messageFrom(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return `${fallback} (${e.message})`;
  return fallback;
}

const styles = StyleSheet.create({
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 8, marginHorizontal: 4 },
  note: { fontSize: 12, lineHeight: 17, marginTop: 6, marginHorizontal: 4 },
  btn: { marginTop: 12 },
  statusRow: { marginTop: 16, alignItems: 'center' },
  statusCard: { marginTop: 16, paddingHorizontal: 14, paddingVertical: 12 },
  statusText: { fontSize: 13, lineHeight: 18 },
});
