import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/ui/Card';
import { ListGroup, type RowSpec } from '@/components/ui/ListGroup';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import type { StepsRow } from '@/lib/core/db/schema';
import { listStepsDays, setManualSteps, syncDaySteps } from '@/lib/core/db/steps';
import { getHealthService } from '@/lib/core/services/healthProvider';
import { useTheme } from '@/lib/theme/theme';

type HealthState = 'idle' | 'connecting' | 'connected' | 'denied' | 'unavailable';

/// Enter today's steps by hand (one row per day) and review recent days. A
/// manual entry is sticky — the passive OS sync never overwrites it (source
/// 'manual'), so a typed number is never silently replaced.
export default function StepsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();

  const [items, setItems] = useState<StepsRow[] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<HealthState>('idle');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db) return;
        const list = await listStepsDays(db, 30);
        if (active) setItems(list);
      })();
      return () => {
        active = false;
      };
    }, [db]),
  );

  async function onSave() {
    const steps = toSteps(text);
    if (!db || steps < 0) return;
    setSaving(true);
    try {
      await setManualSteps(db, new Date(), steps);
      setText('');
      setItems(await listStepsDays(db, 30));
    } finally {
      setSaving(false);
    }
  }

  /// Ask the OS health store for read permission. On grant, immediately pull
  /// today's count (device reads never overwrite a 'manual' day — see
  /// syncDaySteps) and refresh the list. Failures degrade honestly to a status
  /// line; manual entry always remains available.
  async function onConnectHealth() {
    if (!db || health === 'connecting') return;
    setHealth('connecting');
    try {
      const svc = getHealthService();
      const granted = await svc.requestPermissions();
      if (!granted) {
        setHealth('denied');
        return;
      }
      await syncDaySteps(db, svc);
      setItems(await listStepsDays(db, 30));
      setHealth('connected');
    } catch {
      setHealth('unavailable');
    }
  }

  const valid = toSteps(text) >= 0 && text.trim().length > 0;

  const rows: RowSpec[] = (items ?? []).map((s) => ({
    key: s.date,
    title: formatDay(s.date),
    subtitle: s.source === 'manual' ? t('steps.source.manual') : t('steps.source.device'),
    right: (
      <Text style={[styles.rowSteps, { color: theme.text }, theme.font.bodySemiBold]}>
        {formatStepCount(s.steps)}
      </Text>
    ),
  }));

  return (
    <Screen>
      <View style={styles.inputRow}>
        <TextField
          value={text}
          onChangeText={setText}
          placeholder={t('steps.placeholder')}
          keyboardType="number-pad"
          style={styles.input}
        />
        <Text style={[styles.unit, { color: theme.subtle }, theme.font.body]}>{t('steps.unit')}</Text>
      </View>
      <PrimaryButton
        label={saving ? t('steps.saving') : t('steps.save')}
        onPress={onSave}
        disabled={db == null || !valid || saving}
        style={styles.save}
      />

      <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{t('steps.note')}</Text>

      <SectionHeader>{t('steps.auto.title')}</SectionHeader>
      <Card style={styles.autoCard}>
        <Text style={[styles.autoExplainer, { color: theme.subtle }, theme.font.body]}>
          {t('steps.auto.explainer')}
        </Text>
        <PrimaryButton
          label={health === 'connecting' ? t('steps.auto.connecting') : t('steps.auto.connect')}
          onPress={onConnectHealth}
          disabled={db == null || health === 'connecting'}
          style={styles.autoBtn}
        />
        {health === 'connected' || health === 'denied' || health === 'unavailable' ? (
          <Text style={[styles.autoStatus, { color: theme.subtle }, theme.font.body]}>
            {t(`steps.auto.${health}`)}
          </Text>
        ) : null}
      </Card>

      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.dbUnavailable')}</Text>
      ) : items == null ? null : items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('steps.empty')}</Text>
      ) : (
        <View style={styles.history}>
          <ListGroup rows={rows} />
        </View>
      )}
    </Screen>
  );
}

/// Whole non-negative step count, or -1 for invalid input.
function toSteps(v: string): number {
  const n = parseInt(v.replace(/\s/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : -1;
}

/// '2026-06-17' → '17.06.2026'.
function formatDay(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/// Group thousands using the locale separator: 8400 → '8 400'.
function formatStepCount(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}


const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, marginBottom: 12 },
  input: { flex: 1 },
  unit: { fontSize: 15 },
  save: { marginBottom: 16 },
  note: { fontSize: 12, lineHeight: 17, marginHorizontal: 4, marginBottom: 16 },
  autoCard: { marginTop: 4 },
  autoExplainer: { fontSize: 13, lineHeight: 19 },
  autoBtn: { marginTop: 12 },
  autoStatus: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  history: { marginTop: 4 },
  rowSteps: { fontSize: 16 },
});
