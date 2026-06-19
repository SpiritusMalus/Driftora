import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { TextField } from '@/components/ui/TextField';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// The unskippable "save your recovery" gate — ported from the LawDocs
/// `key-save-gate` idea, adapted to a phone + RN. Before a recovery-enabled backup
/// can be created on a fresh device, the user must:
///   1. read the honest warning ("без фразы или ключа данные не восстановит никто"),
///   2. save the recovery phrase (the gate shows it; the screen also offers a
///      key-file export), and
///   3. PROVE they saved it by re-typing two of the four phrase groups.
/// Only then does `onConfirmed` fire. This is a confirmation gate, not a security
/// boundary — the phrase is already on screen — but it forces the user to actually
/// copy it down, which is the whole point of E2E recovery.
///
/// The component is presentational: the parent owns the phrase and what "proceed"
/// does (create the backup). It renders inside a modal/overlay on the screen.
export function RecoverySaveGate({
  phrase,
  busy,
  onExportKeyFile,
  onConfirmed,
  onCancel,
}: {
  phrase: string;
  busy: boolean;
  onExportKeyFile: () => void;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles(theme);

  const groups = useMemo(() => splitGroups(phrase), [phrase]);
  // Confirmation: re-enter group #2 and #4 (1-based to the user). Picking
  // non-adjacent groups makes a blind copy/paste of the whole phrase less likely
  // to pass without the user having actually looked at it.
  const challengeIndices = [1, 3];
  const [savedAck, setSavedAck] = useState(false);
  const [exported, setExported] = useState(false);
  const [answers, setAnswers] = useState<string[]>(['', '']);
  const [showError, setShowError] = useState(false);

  const answersMatch = challengeIndices.every(
    (gi, k) => normalize(answers[k]) === normalize(groups[gi] ?? ''),
  );
  const canProceed = savedAck && answersMatch && !busy;

  function tryProceed() {
    if (!answersMatch) {
      setShowError(true);
      return;
    }
    onConfirmed();
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: theme.text }, theme.font.bodyBold]}>
        {t('recovery.gate.title')}
      </Text>

      {/* The honest warning — the one hard limit of real E2E. */}
      <Card style={styles.warnCard}>
        <Text style={[styles.warnText, { color: theme.text }, theme.font.bodyMedium]}>
          {t('recovery.gate.warning')}
        </Text>
      </Card>

      <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>
        {t('recovery.gate.phraseLabel')}
      </Text>
      {/* The phrase itself, big and selectable so the user can copy it. */}
      <Card style={styles.phraseCard}>
        <Text selectable style={[styles.phrase, { color: theme.text }, theme.font.bodySemiBold]}>
          {phrase}
        </Text>
      </Card>

      <PrimaryButton
        label={exported ? t('recovery.gate.exportAgain') : t('recovery.gate.exportKeyFile')}
        onPress={() => {
          onExportKeyFile();
          setExported(true);
        }}
        style={styles.exportBtn}
      />
      <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
        {t('recovery.gate.exportHint')}
      </Text>

      {/* "I saved it" acknowledgement — a tappable check row. */}
      <Card
        style={styles.ackRow}
        padded={false}
        onPress={() => setSavedAck((v) => !v)}
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: theme.primary, backgroundColor: savedAck ? theme.primary : 'transparent' },
          ]}
        >
          {savedAck ? (
            <Text style={[styles.checkmark, { color: theme.onPrimary }]}>✓</Text>
          ) : null}
        </View>
        <Text style={[styles.ackText, { color: theme.text }, theme.font.body]}>
          {t('recovery.gate.savedAck')}
        </Text>
      </Card>

      {/* Confirm by re-typing the requested groups. */}
      <Text style={[styles.label, { color: theme.subtle }, theme.font.body]}>
        {t('recovery.gate.confirmLabel')}
      </Text>
      {challengeIndices.map((gi, k) => (
        <View key={gi} style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>
            {t('recovery.gate.groupN', { n: gi + 1 })}
          </Text>
          <TextField
            value={answers[k]}
            onChangeText={(v) => {
              const next = [...answers];
              next[k] = v;
              setAnswers(next);
              setShowError(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t('recovery.gate.groupPlaceholder')}
          />
        </View>
      ))}

      {showError ? (
        <Text style={[styles.error, { color: theme.primary }, theme.font.body]}>
          {t('recovery.gate.confirmError')}
        </Text>
      ) : null}

      <PrimaryButton
        label={busy ? t('recovery.gate.working') : t('recovery.gate.proceed')}
        onPress={tryProceed}
        disabled={!canProceed}
        style={styles.proceedBtn}
      />
      <Text
        onPress={onCancel}
        style={[styles.cancel, { color: theme.subtle }, theme.font.body]}
      >
        {t('recovery.gate.cancel')}
      </Text>
    </ScrollView>
  );
}

/// Splits "a — b — c — d" (or whitespace-separated) into its groups.
function splitGroups(phrase: string): string[] {
  return phrase
    .split(/—|\s+/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/// Loose compare for the confirmation: trim + strip whitespace, but keep case
/// (the phrase is base64 → case matters).
function normalize(s: string): string {
  return s.replace(/\s+/g, '').trim();
}

function useStyles(theme: Theme) {
  return useMemo(
    () =>
      StyleSheet.create({
        container: { padding: 20, paddingBottom: 40 },
        title: { fontSize: 20, marginBottom: 14 },
        warnCard: { backgroundColor: theme.card, marginBottom: 18 },
        warnText: { fontSize: 14, lineHeight: 20 },
        label: { fontSize: 12, marginTop: 10, marginBottom: 6, marginHorizontal: 2 },
        phraseCard: { marginBottom: 14 },
        phrase: { fontSize: 18, lineHeight: 28, letterSpacing: 0.5, textAlign: 'center' },
        exportBtn: { marginTop: 4 },
        hint: { fontSize: 12, lineHeight: 17, marginTop: 8, marginHorizontal: 2 },
        ackRow: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 14,
          paddingVertical: 12,
          marginTop: 16,
          marginBottom: 4,
        },
        checkbox: {
          width: 22,
          height: 22,
          borderRadius: 6,
          borderWidth: 2,
          alignItems: 'center',
          justifyContent: 'center',
          marginRight: 12,
        },
        checkmark: { fontSize: 14, fontWeight: '700' },
        ackText: { fontSize: 14, flex: 1, lineHeight: 19 },
        field: { marginBottom: 10 },
        fieldLabel: { fontSize: 12, marginBottom: 5 },
        error: { fontSize: 13, marginTop: 4, marginHorizontal: 2 },
        proceedBtn: { marginTop: 18 },
        cancel: { fontSize: 14, textAlign: 'center', marginTop: 16, padding: 8 },
      }),
    [theme],
  );
}
