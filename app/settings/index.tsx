import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { getDbDriver } from '@/lib/core/db/client';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import { ensureSettings, parseReminderTimes, updateSettings } from '@/lib/core/db/settings';
import { getNotificationService } from '@/lib/core/services/notificationProvider';
import { buildDailyReminders, rescheduleReminders } from '@/lib/core/services/reminders';
import { nextReminder } from '@/lib/core/services/reminderSchedule';
import { colors, type ThemeColors } from '@/lib/theme/colors';
import { fonts } from '@/lib/theme/typography';

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/// Edits the single app_settings row: macro/step targets, reminder times, and
/// the privacy/mode flags. Reminders are stored now; firing them needs
/// expo-notifications on a device (see the note).
export default function SettingsScreen() {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? colors.dark : colors.light;
  const db = useDatabase();

  const [loaded, setLoaded] = useState(false);
  const [kcal, setKcal] = useState('2000');
  const [protein, setProtein] = useState('120');
  const [fat, setFat] = useState('70');
  const [carb, setCarb] = useState('200');
  const [stepsGoal, setStepsGoal] = useState('7000');
  const [reminders, setReminders] = useState<string[]>([]);
  const [newTime, setNewTime] = useState('');
  const [hideCalories, setHideCalories] = useState(false);
  const [llmDiaryAssist, setLlmDiaryAssist] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showPopulationStats, setShowPopulationStats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        if (!db || loaded) return;
        const s = await ensureSettings(db);
        if (!active) return;
        setKcal(String(s.targetKcal));
        setProtein(String(s.targetProteinG));
        setFat(String(s.targetFatG));
        setCarb(String(s.targetCarbG));
        setStepsGoal(String(s.stepsGoal));
        setReminders(parseReminderTimes(s.reminderTimes));
        setHideCalories(s.hideCalories);
        setLlmDiaryAssist(s.llmDiaryAssist);
        setPaused(s.paused);
        setShowPopulationStats(s.showPopulationStats);
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
        targetKcal: toNumber(kcal),
        targetProteinG: toNumber(protein),
        targetFatG: toNumber(fat),
        targetCarbG: toNumber(carb),
        stepsGoal: Math.round(toNumber(stepsGoal)),
        reminderTimes: reminders,
        hideCalories,
        llmDiaryAssist,
        paused,
        showPopulationStats,
      });
      await syncReminders();
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  /// Re-applies the saved reminders to the OS scheduler. A break (`paused`)
  /// clears them; otherwise we ask for permission once and schedule the set.
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
      if (specs.length > 0) await service.requestPermissions();
      await rescheduleReminders(service, specs);
    } catch (e) {
      console.warn('reminder scheduling failed', e);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {db == null ? (
        <Text style={[styles.hint, { color: theme.subtle }]}>{t('settings.dbUnavailable')}</Text>
      ) : null}

      <Text style={[styles.section, { color: theme.subtle }]}>{t('settings.breakTitle')}</Text>
      <ToggleRow label={t('settings.pause')} value={paused} onChange={(v) => { setPaused(v); dirty(); }} theme={theme} />
      <Text style={[styles.note, { color: theme.subtle }]}>{t('settings.pauseNote')}</Text>

      <Text style={[styles.section, { color: theme.subtle }]}>{t('settings.targets')}</Text>
      <NumberField label={t('settings.targetKcal')} value={kcal} onChange={(v) => { setKcal(v); dirty(); }} theme={theme} />
      <NumberField label={t('settings.targetProtein')} value={protein} onChange={(v) => { setProtein(v); dirty(); }} theme={theme} />
      <NumberField label={t('settings.targetFat')} value={fat} onChange={(v) => { setFat(v); dirty(); }} theme={theme} />
      <NumberField label={t('settings.targetCarb')} value={carb} onChange={(v) => { setCarb(v); dirty(); }} theme={theme} />
      <NumberField label={t('settings.stepsGoal')} value={stepsGoal} onChange={(v) => { setStepsGoal(v); dirty(); }} theme={theme} />

      <Text style={[styles.section, { color: theme.subtle }]}>{t('settings.reminders')}</Text>
      {reminders.map((time) => (
        <View key={time} style={[styles.timeRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.timeText, { color: theme.text }]}>{time}</Text>
          <Pressable onPress={() => { setReminders(reminders.filter((x) => x !== time)); dirty(); }} hitSlop={8}>
            <Text style={{ color: theme.subtle }}>✕</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.timeAddRow}>
        <TextInput
          value={newTime}
          onChangeText={setNewTime}
          placeholder={t('settings.reminderAdd')}
          placeholderTextColor={theme.subtle}
          style={[styles.timeInput, { color: theme.text, backgroundColor: theme.card, borderColor: theme.border }]}
        />
        <Pressable onPress={addTime} style={({ pressed }) => [styles.timeAddBtn, { borderColor: theme.primary, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.timeAddText, { color: theme.primary }]}>{t('settings.reminderAddBtn')}</Text>
        </Pressable>
      </View>
      <Text style={[styles.note, { color: theme.subtle }]}>{t('settings.remindersNote')}</Text>
      {(() => {
        const next = nextReminder(reminders);
        if (!next) return null;
        const pad = (n: number) => String(n).padStart(2, '0');
        const isToday = next.getDate() === new Date().getDate();
        const when = `${isToday ? t('settings.today') : t('settings.tomorrow')} ${pad(next.getHours())}:${pad(next.getMinutes())}`;
        return (
          <Text style={[styles.note, { color: theme.subtle }]}>
            {t('settings.nextReminder', { when })}
          </Text>
        );
      })()}

      <Text style={[styles.section, { color: theme.subtle }]}>{t('settings.flags')}</Text>
      <ToggleRow label={t('settings.hideCalories')} value={hideCalories} onChange={(v) => { setHideCalories(v); dirty(); }} theme={theme} />
      <ToggleRow label={t('settings.llmDiaryAssist')} value={llmDiaryAssist} onChange={(v) => { setLlmDiaryAssist(v); dirty(); }} theme={theme} />
      <ToggleRow label={t('settings.showPopulationStats')} value={showPopulationStats} onChange={(v) => { setShowPopulationStats(v); dirty(); }} theme={theme} />
      <Text style={[styles.note, { color: theme.subtle }]}>{t('settings.showPopulationStatsNote')}</Text>

      {db != null
        ? (() => {
            const encrypted = getDbDriver() === 'op-sqlite';
            return (
              <>
                <Text style={[styles.section, { color: theme.subtle }]}>{t('settings.storage')}</Text>
                <View style={[styles.toggleRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.toggleLabel, { color: theme.text }]}>
                    {encrypted ? t('settings.storageEncrypted') : t('settings.storageUnencrypted')}
                  </Text>
                  <Text style={{ color: encrypted ? theme.primary : theme.subtle, fontSize: 16 }}>
                    {encrypted ? '🔒' : '⚠️'}
                  </Text>
                </View>
                {encrypted ? null : (
                  <Text style={[styles.note, { color: theme.subtle }]}>{t('settings.storageUnencryptedNote')}</Text>
                )}
              </>
            );
          })()
        : null}

      <Pressable
        onPress={onSave}
        disabled={db == null || saving}
        style={({ pressed }) => [
          styles.saveBtn,
          { backgroundColor: theme.primary, opacity: db == null || saving ? 0.4 : pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.saveText, { color: theme.onPrimary }]}>
          {saving ? t('settings.saving') : saved ? t('settings.saved') : t('settings.save')}
        </Text>
      </Pressable>
    </ScrollView>
  );
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
  theme: ThemeColors;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.subtle }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        style={[styles.input, { color: theme.text, backgroundColor: theme.card, borderColor: theme.border }]}
      />
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
  theme: ThemeColors;
}) {
  return (
    <View style={[styles.toggleRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={[styles.toggleLabel, { color: theme.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.primary, false: theme.border }} />
    </View>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  hint: { fontFamily: fonts.body, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  section: { fontFamily: fonts.heading, fontSize: 11, letterSpacing: 1.2, marginTop: 24, marginBottom: 10 },
  field: { marginBottom: 12 },
  fieldLabel: { fontFamily: fonts.body, fontSize: 12, marginBottom: 5 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  timeText: { fontFamily: fonts.bodyMedium, fontSize: 15 },
  timeAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  timeInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  timeAddBtn: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  timeAddText: { fontFamily: fonts.bodySemiBold, fontSize: 14 },
  note: { fontFamily: fonts.body, fontSize: 11, fontStyle: 'italic', marginTop: 8, lineHeight: 16 },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  toggleLabel: { fontFamily: fonts.body, fontSize: 14, flex: 1, paddingRight: 12 },
  saveBtn: { borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 20 },
  saveText: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
});
