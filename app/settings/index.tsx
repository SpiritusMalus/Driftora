import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { LegalReader } from '@/components/legal/LegalReader';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { TextField } from '@/components/ui/TextField';
import { grantAiConsent, needsAiConsent, revokeAiConsent } from '@/lib/core/consent/consent';
import { getDbDriver } from '@/lib/core/db/client';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { ensureSettings, parseReminderTimes, updateSettings } from '@/lib/core/db/settings';
import type { LegalDoc } from '@/lib/legal/documents';
import { SITE_URL } from '@/lib/legal/links';
import { getStepsForDay, dayKey } from '@/lib/core/db/steps';
import { latestMood } from '@/lib/core/db/mood';
import { planNudges } from '@/lib/core/insights/nudgeRules';
import { getNotificationService } from '@/lib/core/services/notificationProvider';
import {
  buildContextNudgeReminders,
  buildDailyReminders,
  rescheduleReminders,
  type NudgeCopy,
} from '@/lib/core/services/reminders';
import { nextReminder } from '@/lib/core/services/reminderSchedule';
import { type Theme, useTheme } from '@/lib/theme/theme';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/// Edits the single app_settings row: macro/step targets, reminder times, and
/// the privacy/mode flags. Reminders are stored now; firing them needs
/// expo-notifications on a device (see the note).
export default function SettingsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDatabase();
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [stepsGoal, setStepsGoal] = useState('7000');
  const [reminders, setReminders] = useState<string[]>([]);
  const [newTime, setNewTime] = useState('');
  const [hideCalories, setHideCalories] = useState(false);
  const [llmDiaryAssist, setLlmDiaryAssist] = useState(false);
  const [paused, setPaused] = useState(false);
  const [contextualNudges, setContextualNudges] = useState(false);
  const [showPopulationStats, setShowPopulationStats] = useState(false);
  const [region, setRegion] = useState<'auto' | 'RU' | 'US'>('auto');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Cross-border AI consent — persisted immediately on toggle (not via Save),
  // since it is a consent action. Version drives the re-prompt logic.
  const [aiConsent, setAiConsent] = useState(false);
  const [aiConsentVersion, setAiConsentVersion] = useState('');
  const [aiPromptVisible, setAiPromptVisible] = useState(false);
  const [reader, setReader] = useState<LegalDoc | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db || loaded) return;
        const s = await ensureSettings(db);
        if (!active) return;
        setStepsGoal(String(s.stepsGoal));
        setReminders(parseReminderTimes(s.reminderTimes));
        setHideCalories(s.hideCalories);
        setLlmDiaryAssist(s.llmDiaryAssist);
        setPaused(s.paused);
        setContextualNudges(s.contextualNudges);
        setShowPopulationStats(s.showPopulationStats);
        setRegion(s.region);
        setAiConsent(s.aiFoodParseConsent);
        setAiConsentVersion(s.aiFoodParseConsentVersion);
        setLoaded(true);
      })();
      return () => {
        active = false;
      };
    }, [db, loaded]),
  );

  const dirty = () => setSaved(false);

  function addTime() {
    const v = newTime.trim();
    if (!TIME_RE.test(v) || reminders.includes(v)) return;
    setReminders([...reminders, v].sort());
    setNewTime('');
    dirty();
  }

  async function onSave() {
    if (!db) return;
    setSaving(true);
    try {
      await updateSettings(db, {
        stepsGoal: Math.round(toNumber(stepsGoal)),
        reminderTimes: reminders,
        hideCalories,
        llmDiaryAssist,
        paused,
        contextualNudges,
        showPopulationStats,
        region,
      });
      await syncReminders();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  /// Re-applies the saved reminders to the OS scheduler. A break (`paused`)
  /// clears them; otherwise we ask for permission once and schedule the set.
  /// When contextual nudges are on, today's passive signals are read and the
  /// pure JITAI rules decide whether to add a gentle, capped movement nudge —
  /// recomputed on every save so it reflects the latest context.
  /// Best-effort — a missing notification backend never blocks saving.
  async function syncReminders() {
    try {
      const service = getNotificationService();
      await service.initialize();
      const specs = buildDailyReminders(
        reminders,
        { title: t('notifications.reminderTitle'), body: t('notifications.reminderBody') },
        paused,
      );
      if (db && contextualNudges && !paused) {
        const now = new Date();
        const steps = await getStepsForDay(db, now);
        const lastMood = await latestMood(db);
        // Only count a mood logged *today* — yesterday's check-in is not context.
        const moodToday =
          lastMood && dayKey(new Date(lastMood.ts)) === dayKey(now) ? lastMood.value : null;
        const nudges = planNudges({
          hour: now.getHours(),
          steps,
          stepsGoal: Math.round(toNumber(stepsGoal)),
          mood: moodToday,
          paused,
        });
        specs.push(...buildContextNudgeReminders(nudges, nudgeCopy(t), paused));
      }
      if (specs.length > 0) await service.requestPermissions();
      await rescheduleReminders(service, specs);
    } catch (e) {
      console.warn('reminder scheduling failed', e);
    }
  }

  /// AI toggle. ON → run the just-in-time consent capture (§B); the switch only
  /// moves to ON once accepted. OFF → revoke immediately and fall back to the
  /// offline stub. Consent is persisted here, independent of the Save button.
  async function onToggleAi(next: boolean) {
    if (!db) return;
    if (next) {
      if (needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
        setAiPromptVisible(true);
        return;
      }
      // Already consented at the current version — just reflect it.
      setAiConsent(true);
    } else {
      await revokeAiConsent(db);
      setAiConsent(false);
    }
  }

  async function onAiConsentAccept() {
    setAiPromptVisible(false);
    if (!db) return;
    await grantAiConsent(db);
    const s = await ensureSettings(db);
    setAiConsent(s.aiFoodParseConsent);
    setAiConsentVersion(s.aiFoodParseConsentVersion);
  }

  function onAiConsentDecline() {
    setAiPromptVisible(false);
    // Toggle never moved to ON; consent stays false → offline stub.
  }

  return (
    <Screen>
      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
          {t('settings.dbUnavailable')}
        </Text>
      ) : null}

      <SectionHeader>{t('settings.breakTitle')}</SectionHeader>
      <ToggleRow label={t('settings.pause')} value={paused} onChange={(v) => { setPaused(v); dirty(); }} theme={theme} />
      <Note theme={theme}>{t('settings.pauseNote')}</Note>

      <SectionHeader>{t('settings.targets')}</SectionHeader>
      <NumberField label={t('settings.stepsGoal')} value={stepsGoal} onChange={(v) => { setStepsGoal(v); dirty(); }} theme={theme} />
      {/* КБЖУ targets live on the Weight screen now — next to BMI + the formula. */}
      <Note theme={theme}>{t('settings.targetsMoved')}</Note>

      <SectionHeader>{t('settings.reminders')}</SectionHeader>
      {reminders.map((time) => (
        <Card key={time} style={styles.timeRow} padded={false}>
          <Text style={[styles.timeText, { color: theme.text }, theme.font.bodyMedium]}>{time}</Text>
          <Pressable onPress={() => { setReminders(reminders.filter((x) => x !== time)); dirty(); }} hitSlop={8}>
            <Text style={{ color: theme.subtle }}>✕</Text>
          </Pressable>
        </Card>
      ))}
      <View style={styles.timeAddRow}>
        <TextField
          value={newTime}
          onChangeText={setNewTime}
          placeholder={t('settings.reminderAdd')}
          style={styles.timeInput}
        />
        <Pressable onPress={addTime} style={({ pressed }) => [styles.timeAddBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.timeAddText, { color: theme.primary }, theme.font.bodySemiBold]}>
            {t('settings.reminderAddBtn')}
          </Text>
        </Pressable>
      </View>
      <Note theme={theme}>{t('settings.remindersNote')}</Note>
      {(() => {
        const next = nextReminder(reminders);
        if (!next) return null;
        const pad = (n: number) => String(n).padStart(2, '0');
        const isToday = next.getDate() === new Date().getDate();
        const when = `${isToday ? t('settings.today') : t('settings.tomorrow')} ${pad(next.getHours())}:${pad(next.getMinutes())}`;
        return <Note theme={theme}>{t('settings.nextReminder', { when })}</Note>;
      })()}
      <ToggleRow label={t('settings.contextualNudges')} value={contextualNudges} onChange={(v) => { setContextualNudges(v); dirty(); }} theme={theme} />
      <Note theme={theme}>{t('settings.contextualNudgesNote')}</Note>

      <SectionHeader>{t('settings.regionTitle')}</SectionHeader>
      <View style={styles.segment}>
        {(['auto', 'RU', 'US'] as const).map((opt) => {
          const active = region === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => { setRegion(opt); dirty(); }}
              style={({ pressed }) => [
                styles.segmentBtn,
                {
                  backgroundColor: active ? theme.primary : theme.card,
                  borderColor: active ? theme.primary : theme.separator,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={[styles.segmentText, { color: active ? theme.onPrimary : theme.text }, theme.font.bodySemiBold]}>
                {t(`settings.region_${opt}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Note theme={theme}>{t('settings.regionNote')}</Note>

      <SectionHeader>{t('settings.flags')}</SectionHeader>
      <Note theme={theme}>{t('settings.privacyLine')}</Note>
      {/* AI food recognition — bound to aiFoodParseConsent, OFF by default.
          Persisted immediately (consent action), not via the Save button. */}
      <ToggleRow label={t('settings.aiToggle')} value={aiConsent} onChange={onToggleAi} theme={theme} />
      <Note theme={theme}>{aiConsent ? t('settings.aiOn') : t('settings.aiOff')}</Note>
      <ToggleRow label={t('settings.hideCalories')} value={hideCalories} onChange={(v) => { setHideCalories(v); dirty(); }} theme={theme} />
      <ToggleRow label={t('settings.llmDiaryAssist')} value={llmDiaryAssist} onChange={(v) => { setLlmDiaryAssist(v); dirty(); }} theme={theme} />
      <ToggleRow label={t('settings.showPopulationStats')} value={showPopulationStats} onChange={(v) => { setShowPopulationStats(v); dirty(); }} theme={theme} />
      <Note theme={theme}>{t('settings.showPopulationStatsNote')}</Note>

      <SectionHeader>{t('legal.privacy')}</SectionHeader>
      <Card style={styles.toggleRow} padded={false} onPress={() => setReader('terms')}>
        <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>{t('legal.terms')}</Text>
        <Text style={{ color: theme.primary, fontSize: 20 }}>›</Text>
      </Card>
      <Card style={styles.toggleRow} padded={false} onPress={() => setReader('privacy')}>
        <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>{t('legal.privacy')}</Text>
        <Text style={{ color: theme.primary, fontSize: 20 }}>›</Text>
      </Card>
      {/* Neutral studio landing page — no purchase/steering wording (iOS-safe). */}
      <Card style={styles.toggleRow} padded={false} onPress={() => void Linking.openURL(SITE_URL)}>
        <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>{t('settings.site')}</Text>
        <Text style={{ color: theme.primary, fontSize: 16 }}>↗</Text>
      </Card>

      {db != null
        ? (() => {
            const encrypted = getDbDriver() === 'op-sqlite';
            return (
              <>
                <SectionHeader>{t('settings.storage')}</SectionHeader>
                <Card style={styles.toggleRow} padded={false}>
                  <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>
                    {encrypted ? t('settings.storageEncrypted') : t('settings.storageUnencrypted')}
                  </Text>
                  <Text style={{ color: encrypted ? theme.primary : theme.subtle, fontSize: 16 }}>
                    {encrypted ? '🔒' : '⚠️'}
                  </Text>
                </Card>
                {encrypted ? null : <Note theme={theme}>{t('settings.storageUnencryptedNote')}</Note>}
              </>
            );
          })()
        : null}

      <SectionHeader>{t('backup.title')}</SectionHeader>
      <Card style={styles.toggleRow} padded={false} onPress={() => router.push('/settings/backup')}>
        <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>
          {t('backup.openRow')}
        </Text>
        <Text style={{ color: theme.primary, fontSize: 20 }}>›</Text>
      </Card>
      <Note theme={theme}>{t('backup.openRowNote')}</Note>

      <PrimaryButton
        label={saving ? t('settings.saving') : saved ? t('settings.saved') : t('settings.save')}
        onPress={onSave}
        disabled={db == null || saving}
        style={styles.save}
      />

      <ConsentModal
        visible={aiPromptVisible}
        title={t('consent.ai.title')}
        body={t('consent.ai.body')}
        confirmLabel={t('consent.ai.accept')}
        declineLabel={t('consent.ai.decline')}
        declineCaption={t('consent.ai.declineCaption')}
        onConfirm={onAiConsentAccept}
        onDecline={onAiConsentDecline}
      />
      <LegalReader doc={reader} visible={reader != null} onClose={() => setReader(null)} />
    </Screen>
  );
}

function Note({ children, theme }: { children: string; theme: Theme }) {
  return <Text style={[styles.note, { color: theme.subtle }, theme.font.body]}>{children}</Text>;
}

function NumberField({
  label,
  value,
  onChange,
  theme,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  theme: Theme;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }, theme.font.body]}>{label}</Text>
      <TextField value={value} onChangeText={onChange} keyboardType="numeric" />
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  theme,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  theme: Theme;
}) {
  return (
    <Card style={styles.toggleRow} padded={false}>
      <Text style={[styles.toggleLabel, { color: theme.text }, theme.font.body]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: theme.primary, false: theme.separator }}
        ios_backgroundColor={theme.separator}
      />
    </Card>
  );
}

/// Maps each nudge type to its localized title/body. Kept here (UI layer) so the
/// rules engine and the reminders service stay translation-free.
function nudgeCopy(t: (key: string) => string): NudgeCopy {
  return {
    mood_walk: { title: t('notifications.nudge.moodWalkTitle'), body: t('notifications.nudge.moodWalkBody') },
    afternoon_walk: { title: t('notifications.nudge.afternoonWalkTitle'), body: t('notifications.nudge.afternoonWalkBody') },
    evening_walk: { title: t('notifications.nudge.eveningWalkTitle'), body: t('notifications.nudge.eveningWalkBody') },
  };
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, textAlign: 'center', marginBottom: 12 },
  field: { marginBottom: 12 },
  fieldLabel: { fontSize: 12, marginBottom: 5 },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  timeText: { fontSize: 15 },
  timeAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  timeInput: { flex: 1 },
  timeAddBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12 },
  timeAddText: { fontSize: 14 },
  note: { fontSize: 11, fontStyle: 'italic', marginTop: 8, lineHeight: 16, marginHorizontal: 4 },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
  },
  toggleLabel: { fontSize: 14, flex: 1, paddingRight: 12 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentBtn: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
  segmentText: { fontSize: 14 },
  save: { marginTop: 20 },
});
