import { Paths, File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

import { RecoverySaveGate } from '@/components/backup/RecoverySaveGate';
import { AccordionChevron } from '@/components/ui/AccordionChevron';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen, ScreenBackground } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { animateLayout, useReducedMotion } from '@/lib/theme/motion';
import { grantSyncConsent, revokeSyncConsent } from '@/lib/core/consent/consent';
import { generateRecoveryPhrase, parseKeyFile, RecoveryFileError, serializeKeyFile } from '@/lib/core/crypto/recovery';
import { exportAllTables, importAllTables, type BackupDocument } from '@/lib/core/db/backup';
import {
  buildBackupFile,
  decryptBackupBody,
  parseBackupFile,
  recoverMasterKeyFromFile,
} from '@/lib/core/db/backupFile';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  BiometricGateError,
  hasMasterKey,
  installMasterKeyPair,
  tryRestoreMasterKeyFromPlatform,
  unlockMasterKeyPair,
} from '@/lib/core/db/keystore';
import { ensureSettings } from '@/lib/core/db/settings';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Between-device sync is not shippable yet: the operator-server transport is
/// deprecated (ADR-2026-06-23) and the platform-native one (CloudKit / Drive App
/// Data) hasn't landed, so `getDataSyncProvider` resolves to "unavailable" and
/// the toggle would transfer nothing. Hide the whole section until a real
/// transport exists — showing a dead "синхронизация через наш сервер" switch only
/// confuses (user feedback 2026-06-25). Flip to `true` when sync actually works.
const SYNC_UI_ENABLED = false;

/// "Резервная копия" — local encrypted backup & restore (no server), now with the
/// Phase-2 user-held RECOVERY fallback so a backup restores on a NEW device.
///
/// Backup:  exportAllTables → JSON → buildBackupFile (encryptBlob body to the
///          master PUBLIC key + a recovery header = master PRIVATE key wrapped
///          under a recovery phrase) → write file → OS share-sheet (the user's own
///          cloud). The unskippable save-gate forces the user to save the phrase /
///          key-file before the file is written.
/// Restore: pick a file → if this device has no master key (fresh install), ask
///          for the recovery phrase → unwrap + install the key → decrypt body →
///          importAllTables. If the key is already here, decrypt directly.
/// Key-file: a power-user path — export the raw key as JSON, or import one to
///          install the master key without a phrase.
///
/// All crypto + DB logic lives in `lib/core/crypto/{e2ee,recovery}.ts` +
/// `lib/core/db/{backup,backupFile}.ts` (unit-tested in node); this screen is the
/// thin native glue (file IO + share/pick + the recovery UX).
///
/// Phase-2 native (this screen wires it; verified on a dev build, not in CI):
///  - Biometric unlock — sensitive key reads (backup, key-file export, restore-
///    decrypt) go through `keystore.unlockMasterKeyPair`, which gates on Face ID /
///    fingerprint (graceful no-op where biometrics are unavailable).
///  - Same-ecosystem "no phrase needed" restore — `tryRestoreMasterKeyFromPlatform`
///    pulls the master key from iCloud Keychain / Google Block Store before we fall
///    back to the recovery-phrase prompt. See `lib/core/security/*` + the native
///    `modules/platform-key-store`.
type Status =
  | { kind: 'idle' }
  | { kind: 'working'; op: 'backup' | 'restore' }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const BACKUP_EXTENSION = 'hrbackup';
const KEYFILE_NAME = 'driftora-key.json';

export default function BackupScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const promptStyles = makePromptStyles(theme);
  const db = useDatabase();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // Save-gate overlay: when set, we have generated a phrase and are blocking on
  // the user saving it before the backup file is written.
  const [gatePhrase, setGatePhrase] = useState<string | null>(null);
  const [gateBusy, setGateBusy] = useState(false);

  // Restore-by-phrase prompt: holds the picked-but-not-yet-decrypted file when a
  // fresh device needs the recovery phrase.
  const [phrasePrompt, setPhrasePrompt] = useState<{ recovery: string; bodyB64: string } | null>(
    null,
  );
  const [phraseInput, setPhraseInput] = useState('');
  const [phraseError, setPhraseError] = useState(false);

  // Server-backed sync opt-in (Phase 3). Default OFF; persisted immediately on
  // toggle (a consent action), like the food→AI consent. The actual push/pull is
  // the dev-build sync client (lib/core/sync/syncClient.ts), gated on this flag.
  const [syncEnabled, setSyncEnabled] = useState(false);

  // Power-user key-file block — collapsed by default so it stops competing with
  // the two hero actions (Create / Restore). Same accordion idiom as «Как это
  // работает».
  const [keyFileOpen, setKeyFileOpen] = useState(false);
  const reduced = useReducedMotion();

  const working = status.kind === 'working';

  // Load the persisted sync opt-in once the DB is ready.
  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) return;
      const s = await ensureSettings(db);
      if (active) setSyncEnabled(s.syncEnabled);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  /// Sync toggle. ON → record consent (epoch + version) and flip on. OFF → revoke
  /// immediately; the sync client then refuses to transfer. Local data and any
  /// saved backups are untouched either way. No network call happens here — this
  /// only sets the opt-in; transfers run from the sync client on a dev build.
  async function onToggleSync(next: boolean) {
    if (!db) return;
    if (next) {
      await grantSyncConsent(db);
      setSyncEnabled(true);
    } else {
      await revokeSyncConsent(db);
      setSyncEnabled(false);
    }
  }

  // ── Backup ────────────────────────────────────────────────────────────────
  /// Start a backup: generate a recovery phrase and open the save-gate. The file
  /// is only written after the user confirms they saved the phrase (in the gate).
  function onStartBackup() {
    if (!db || working) return;
    setStatus({ kind: 'idle' });
    setGatePhrase(generateRecoveryPhrase());
  }

  /// Called by the save-gate once the user has saved + confirmed the phrase. Builds
  /// the recovery-enabled backup file and hands it to the share-sheet.
  async function onGateConfirmed() {
    if (!db || gatePhrase == null) return;
    setGateBusy(true);
    // The encrypted backup file lives in the app cache only long enough to hand
    // it to the OS share-sheet. Track it so we can delete it once shared (or on
    // error) — no reason to leave a copy of the whole DB sitting in cache.
    let file: File | null = null;
    // Keep the cache file ONLY in the no-share-sheet fallback, where it is the
    // user's sole copy. Shared or errored → delete it below.
    let keepFile = false;
    try {
      const doc = await exportAllTables(db);
      // Biometric-gated read of the master key before it is used to build the file.
      const master = await unlockMasterKeyPair(t('keysync.biometricReason'));
      const fileBytes = await buildBackupFile(doc, master, gatePhrase);

      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      file = new File(Paths.cache, `driftora-backup-${stamp}.${BACKUP_EXTENSION}`);
      file.create({ overwrite: true });
      file.write(fileBytes);

      setGatePhrase(null);
      setGateBusy(false);

      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/octet-stream',
          dialogTitle: t('backup.shareTitle'),
        });
        setStatus({ kind: 'done', message: t('backup.backupDone') });
      } else {
        keepFile = true; // no share-sheet: the cache file is the only copy
        setStatus({ kind: 'done', message: t('backup.savedLocally', { path: file.uri }) });
      }
    } catch (e) {
      setGatePhrase(null);
      setGateBusy(false);
      const message =
        e instanceof BiometricGateError
          ? t('keysync.gateFailed')
          : messageFrom(e, t('backup.backupError'));
      setStatus({ kind: 'error', message });
    } finally {
      if (file != null && !keepFile) safeDelete(file);
    }
  }

  /// Export the raw master key as a JSON key-file (power-user fallback). Available
  /// both from the save-gate and as its own button.
  async function onExportKeyFile() {
    // This file is the RAW private key in plaintext JSON — it must not linger in
    // the app cache after it has been handed off. Delete it once shared (or on
    // error); keep it only in the no-share-sheet fallback where it's the sole copy.
    let file: File | null = null;
    let keepFile = false;
    try {
      // The key-file reveals the raw private key → gate it behind biometrics too.
      const master = await unlockMasterKeyPair(t('keysync.biometricReason'));
      const json = serializeKeyFile(master);
      file = new File(Paths.cache, KEYFILE_NAME);
      file.create({ overwrite: true });
      file.write(new TextEncoder().encode(json));

      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/json',
          dialogTitle: t('recovery.keyFile.shareTitle'),
        });
      } else {
        keepFile = true;
        setStatus({ kind: 'done', message: t('backup.savedLocally', { path: file.uri }) });
      }
    } catch (e) {
      const message =
        e instanceof BiometricGateError
          ? t('keysync.gateFailed')
          : messageFrom(e, t('recovery.keyFile.exportError'));
      setStatus({ kind: 'error', message });
    } finally {
      if (file != null && !keepFile) safeDelete(file);
    }
  }

  /// Import a key-file: validate it (keyPairMatches), then install the master key.
  /// Lets a fresh device restore a backup without typing the recovery phrase.
  async function onImportKeyFile() {
    if (working) return;
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
      const text = new TextDecoder().decode(await file.bytes());
      let pair;
      try {
        pair = parseKeyFile(text);
      } catch (e) {
        const code = e instanceof RecoveryFileError ? e.code : 'invalidFormat';
        setStatus({ kind: 'error', message: t(`recovery.keyFileError.${code}`) });
        return;
      }
      await installMasterKeyPair(pair.privateKey);
      setStatus({ kind: 'done', message: t('recovery.keyFile.imported') });
    } catch (e) {
      setStatus({ kind: 'error', message: messageFrom(e, t('recovery.keyFile.importError')) });
    }
  }

  // ── Restore ───────────────────────────────────────────────────────────────
  /// Restore REPLACES all local data (importAllTables wipes every table first),
  /// so gate it behind an explicit destructive confirmation — the same bar the
  /// app already applies to deleting a single food/diary entry.
  function confirmRestore() {
    if (!db || working) return;
    Alert.alert(t('backup.restoreTitle'), t('backup.restoreReplaceWarning'), [
      { text: t('backup.restoreCancel'), style: 'cancel' },
      { text: t('backup.restoreConfirm'), style: 'destructive', onPress: () => void onRestore() },
    ]);
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
      const fileBytes = await file.bytes();

      let parsed;
      try {
        parsed = parseBackupFile(fileBytes);
      } catch {
        setStatus({ kind: 'error', message: t('backup.restoreError') });
        return;
      }

      // Decide which private key decrypts the body.
      //  1. Key already on this device → biometric-gated read (same-device restore).
      //  2. Fresh device, but the master key arrived via the user's Apple/Google
      //     account (iCloud Keychain / Block Store) → install + use it, NO phrase.
      //  3. Fresh device, no platform key, file has a recovery header → ask for the
      //     recovery phrase (the cross-ecosystem / lost-everything path).
      //  4. Legacy Phase-1 file with no recovery header and no key → nothing here can
      //     decrypt it; show the honest "wrong key" error WITHOUT minting a master key.
      let privateKey: string;
      let restoredViaPlatform = false;
      if (await hasMasterKey()) {
        privateKey = (await unlockMasterKeyPair(t('keysync.biometricReason'))).privateKey;
      } else {
        const platform = await tryRestoreMasterKeyFromPlatform();
        if (platform) {
          privateKey = platform.privateKey;
          restoredViaPlatform = true;
        } else if (parsed.recovery) {
          setPhrasePrompt({ recovery: parsed.recovery, bodyB64: encodeBase64(parsed.bodyCiphertext) });
          setPhraseInput('');
          setPhraseError(false);
          setStatus({ kind: 'idle' });
          return;
        } else {
          // No key on device, no platform custody, no recovery header. A fresh key
          // couldn't decrypt this anyway — surface the error rather than calling
          // getOrCreateMasterKeyPair, which would persist AND mirror a throwaway
          // master key to iCloud just to fail the decrypt below.
          setStatus({ kind: 'error', message: t('backup.restoreWrongKey') });
          return;
        }
      }

      let doc: BackupDocument;
      try {
        doc = decryptBackupBody(parsed, privateKey);
      } catch {
        setStatus({ kind: 'error', message: t('backup.restoreWrongKey') });
        return;
      }

      await importAllTables(db, doc);
      setStatus({
        kind: 'done',
        message: restoredViaPlatform ? t('keysync.autoRestored') : t('backup.restoreDone'),
      });
    } catch (e) {
      const message =
        e instanceof BiometricGateError
          ? t('keysync.gateFailed')
          : messageFrom(e, t('backup.restoreError'));
      setStatus({ kind: 'error', message });
    }
  }

  /// Finish a new-device restore once the user has entered the recovery phrase:
  /// unwrap + install the master key, then decrypt + import.
  async function onSubmitPhrase() {
    if (!db || phrasePrompt == null) return;
    setStatus({ kind: 'working', op: 'restore' });
    try {
      const parsed = {
        bodyCiphertext: decodeBase64(phrasePrompt.bodyB64),
        recovery: phrasePrompt.recovery,
        legacy: false,
      };

      let privateKey: string;
      try {
        privateKey = await recoverMasterKeyFromFile(parsed, phraseInput);
      } catch {
        setPhraseError(true);
        setStatus({ kind: 'idle' });
        return;
      }

      await installMasterKeyPair(privateKey);
      const doc = decryptBackupBody(parsed, privateKey);
      await importAllTables(db, doc);

      setPhrasePrompt(null);
      setStatus({ kind: 'done', message: t('backup.restoreDone') });
    } catch (e) {
      setStatus({ kind: 'error', message: messageFrom(e, t('backup.restoreError')) });
    }
  }

  return (
    <Screen>
      {db == null ? (
        <Card style={styles.dbCard}>
          <Text style={[styles.dbText, { color: theme.accent }, theme.font.bodyMedium]}>
            {t('backup.dbUnavailable')}
          </Text>
        </Card>
      ) : null}

      {/* Hero — the privacy anchor, promoted out of the old 12px bottom note:
          encrypted with your key, and honest that without your phrase not even we
          can open it (folds in the former backup.intro + backup.safetyNote). */}
      <View style={styles.hero}>
        <Text style={[styles.heroLine, { color: theme.heroText }, theme.font.heading]}>
          {t('backup.heroText')}
        </Text>
        <Text style={[styles.heroLine, { color: theme.heroAccent }, theme.font.heading]}>
          {t('backup.heroLead')}
        </Text>
      </View>

      <SectionHeader>{t('backup.backupTitle')}</SectionHeader>
      <Note theme={theme}>{t('backup.backupExplainer')}</Note>
      <PrimaryButton
        label={status.kind === 'working' && status.op === 'backup' ? t('backup.working') : t('backup.backupCta')}
        onPress={onStartBackup}
        disabled={db == null || working}
        style={styles.btn}
      />

      {/* The "replaces all data" warning lives in the destructive confirm Alert
          (confirmRestore), where it is actionable — not repeated as a standing
          note here. */}
      <SectionHeader>{t('backup.restoreTitle')}</SectionHeader>
      <Note theme={theme}>{t('backup.restoreExplainer')}</Note>
      <PrimaryButton
        label={status.kind === 'working' && status.op === 'restore' ? t('backup.working') : t('backup.restoreCta')}
        onPress={confirmRestore}
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

      {/* Power-user key-file path — collapsed by default (accordion), so the two
          hero actions above stay the focus. Both the import (restore-ish) and the
          export (backup-ish, also offered inside the save-gate) live here. */}
      <Card style={styles.advCard}>
        <Pressable
          onPress={() => {
            animateLayout(reduced);
            setKeyFileOpen((v) => !v);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: keyFileOpen }}
          style={styles.advHead}
        >
          <Text style={[styles.advTitle, { color: theme.text }, theme.font.bodyBold]}>
            {t('recovery.keyFile.title')}
          </Text>
          <AccordionChevron expanded={keyFileOpen} size={16} color={theme.subtle} />
        </Pressable>
        {keyFileOpen ? (
          <>
            <Text style={[styles.advBody, { color: theme.subtle }, theme.font.body]}>
              {t('recovery.keyFile.explainer')}
            </Text>
            <PrimaryButton label={t('recovery.keyFile.exportCta')} onPress={onExportKeyFile} disabled={working} style={styles.btn} />
            <PrimaryButton label={t('recovery.keyFile.importCta')} onPress={onImportKeyFile} disabled={working} style={styles.btn} />
          </>
        ) : (
          <Text style={[styles.advTeaser, { color: theme.subtle }, theme.font.body]} numberOfLines={1}>
            {t('recovery.keyFile.teaser')}
          </Text>
        )}
      </Card>

      {/* Between-device sync — hidden until a real transport ships (SYNC_UI_ENABLED).
          When live: opt-in, OFF by default, end-to-end encrypted (server can't read). */}
      {SYNC_UI_ENABLED ? (
        <>
          <SectionHeader>{t('backup.sync.title')}</SectionHeader>
          <Note theme={theme}>{t('backup.sync.explainer')}</Note>
          <Card style={styles.toggleRow} padded={false}>
            <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>
              {t('backup.sync.toggle')}
            </Text>
            <Switch
              value={syncEnabled}
              onValueChange={onToggleSync}
              disabled={db == null}
              trackColor={{ true: theme.primary, false: theme.separator }}
              ios_backgroundColor={theme.separator}
            />
          </Card>
          <Note theme={theme}>{syncEnabled ? t('backup.sync.on') : t('backup.sync.off')}</Note>
          <Note theme={theme}>{t('backup.sync.limitNote')}</Note>
        </>
      ) : null}

      {/* Unskippable save-gate, shown when starting a backup. */}
      <Modal visible={gatePhrase != null} animationType="slide" onRequestClose={() => !gateBusy && setGatePhrase(null)}>
        <ScreenBackground>
          {gatePhrase != null ? (
            <RecoverySaveGate
              phrase={gatePhrase}
              busy={gateBusy}
              onExportKeyFile={onExportKeyFile}
              onConfirmed={onGateConfirmed}
              onCancel={() => {
                if (!gateBusy) setGatePhrase(null);
              }}
            />
          ) : null}
        </ScreenBackground>
      </Modal>

      {/* Recovery-phrase prompt for a new-device restore. */}
      <Modal
        visible={phrasePrompt != null}
        animationType="slide"
        transparent
        onRequestClose={() => setPhrasePrompt(null)}
      >
        <View style={promptStyles.promptOverlay}>
          <Card style={promptStyles.promptCard}>
            <Text style={[promptStyles.promptTitle, { color: theme.text }, theme.font.bodyBold]}>
              {t('recovery.restore.title')}
            </Text>
            <Text style={[promptStyles.promptBody, { color: theme.subtle }, theme.font.body]}>
              {t('recovery.restore.body')}
            </Text>
            <TextField
              value={phraseInput}
              onChangeText={(v) => {
                setPhraseInput(v);
                setPhraseError(false);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              placeholder={t('recovery.restore.placeholder')}
              style={promptStyles.promptInput}
            />
            {phraseError ? (
              <Text style={[promptStyles.promptError, { color: theme.primary }, theme.font.body]}>
                {t('recovery.restore.wrongPhrase')}
              </Text>
            ) : null}
            <PrimaryButton
              label={working ? t('backup.working') : t('recovery.restore.submit')}
              onPress={onSubmitPhrase}
              disabled={working || phraseInput.trim().length === 0}
              style={styles.btn}
            />
            <Text
              onPress={() => setPhrasePrompt(null)}
              style={[promptStyles.promptCancel, { color: theme.subtle }, theme.font.body]}
            >
              {t('recovery.restore.cancel')}
            </Text>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

function Note({ children, theme }: { children: string; theme: Theme }) {
  return <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{children}</Text>;
}

function messageFrom(e: unknown, fallback: string): string {
  // Never surface raw technical error text (file paths, native error codes) in
  // the UI — especially in this backup/restore/key flow, where a scary string
  // only deepens the user's worry about their data. Log it for diagnostics and
  // show the user the actionable fallback message only.
  if (e instanceof Error && e.message) console.warn('[backup]', e.message);
  return fallback;
}

/// Best-effort delete of a cache file we created for share/export. Never throws —
/// the file may already be gone, and a cleanup failure must not reach the user.
function safeDelete(file: File): void {
  try {
    file.delete();
  } catch {
    /* best-effort */
  }
}

const styles = StyleSheet.create({
  hero: { marginTop: 4, marginBottom: 14, marginHorizontal: 4 },
  heroLine: { fontSize: 20, lineHeight: 27 },
  dbCard: { marginBottom: 12 },
  dbText: { fontSize: 13, lineHeight: 18 },
  note: { fontSize: 12, lineHeight: 17, marginTop: 6, marginHorizontal: 4 },
  btn: { marginTop: 12 },
  statusRow: { marginTop: 16, alignItems: 'center' },
  statusCard: { marginTop: 16, paddingHorizontal: 14, paddingVertical: 12 },
  statusText: { fontSize: 13, lineHeight: 18 },
  advCard: { marginTop: 18 },
  advHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  advTitle: { fontSize: 16, flex: 1, paddingRight: 12 },
  advChevron: { fontSize: 15 },
  advBody: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  advTeaser: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  toggleLabel: { fontSize: 14, flex: 1, paddingRight: 12 },
});

/// Themed styles for the recovery-phrase prompt (the only ones that depend on the
/// theme — the card background). Everything static lives in `styles` above.
function makePromptStyles(theme: Theme) {
  return StyleSheet.create({
    promptOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: 20,
    },
    promptCard: { backgroundColor: theme.card },
    promptTitle: { fontSize: 18, marginBottom: 8 },
    promptBody: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
    promptInput: { minHeight: 64 },
    promptError: { fontSize: 13, marginTop: 8 },
    promptCancel: { fontSize: 14, textAlign: 'center', marginTop: 14, padding: 6 },
  });
}
