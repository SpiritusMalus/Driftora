import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { TextField } from '@/components/ui/TextField';
import { Waveform } from '@/components/ui/Waveform';
import { pushLevel } from '@/components/ui/waveformBuffer';
import { AI_CONSENT_VERSION, grantAiConsent, needsAiConsent } from '@/lib/core/consent/consent';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  distinctFoodItemsToday,
  quickMeals,
  saveParsedEntry,
  todayMacroTotals,
  type QuickMeal,
} from '@/lib/core/db/food';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { mealPromptKeyForHour } from '@/lib/core/insights/mealPrompt';
import { proteinInsight } from '@/lib/core/insights/proteinInsight';
import { pickVariant } from '@/lib/core/insights/variant';
import { varietyInsight } from '@/lib/core/insights/varietyInsight';
import {
  isAudioRecordingAvailable,
  startRecording,
  type ActiveRecording,
} from '@/lib/core/services/audioRecorder';
import type { AudioInput, MealDraft, Minerals, NutritionItem, PhotoInput, Region } from '@/lib/core/services/foodParser';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import { recomputeDraft, withItemCookMethod, withItemGrams, withItemManualMacros } from '@/lib/core/services/mealDraft';
import { COOK_METHODS, type CookMethod } from '@/lib/core/insights/cookMethod';
import { capturePhoto, isPhotoCaptureAvailable } from '@/lib/core/services/photoProvider';
import { getSpeechService } from '@/lib/core/services/speechProvider';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Whether an online AI parser is even configured for this build. Consent and
/// the on-screen AI notice only matter when it is — otherwise everything is
/// offline and nothing can leave the device.
const AI_CONFIGURED = !!process.env.EXPO_PUBLIC_FOOD_API_URL;

const MINERAL_KEYS: readonly (keyof Minerals)[] = ['na', 'k', 'ca', 'mg', 'fe', 'zn'];

/// Text/voice → parse → two-tier honest result (exact per-100g + approximate
/// whole-dish total) → confirm grams → save.
export default function FoodLogScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  // The Home mic FAB deep-links here with ?voice=1 to start dictation at once.
  const { voice } = useLocalSearchParams<{ voice?: string }>();
  // Region setting ('auto' until settings load); the active region honors it,
  // falling back to device locale (resolveRegion).
  const [regionSetting, setRegionSetting] = useState<'auto' | 'RU' | 'US'>('auto');
  const region: Region = resolveRegion(regionSetting);

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  // The original estimated grams per item, for the S/M/L presets.
  const [baseGrams, setBaseGrams] = useState<number[]>([]);
  // Today's protein-so-far + personal target, for the honest "what it means"
  // line shown once a meal is parsed (the meaning-rules library).
  const [proteinTarget, setProteinTarget] = useState(0);
  const [todayProteinG, setTodayProteinG] = useState(0);
  const [varietyCount, setVarietyCount] = useState(0);
  const [savedAck, setSavedAck] = useState<string | null>(null);
  const saveSeedRef = useRef(0);
  const [hideCalories, setHideCalories] = useState(false);
  // Cross-border AI consent — mirrors app_settings; drives the parser gate, the
  // just-in-time prompt and the on-screen notice. Starts false (opt-in).
  const [aiConsent, setAiConsent] = useState(false);
  const [aiConsentVersion, setAiConsentVersion] = useState('');
  // Which just-in-time consent modal is open, and the captured input to send if
  // the user accepts (so accept resumes the exact parse they triggered).
  const [consentPrompt, setConsentPrompt] = useState<'text' | 'photo' | 'audio' | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<PhotoInput | null>(null);
  const [pendingAudio, setPendingAudio] = useState<AudioInput | null>(null);
  const [quick, setQuick] = useState<{
    recents: QuickMeal[];
    favorites: QuickMeal[];
    yesterday: QuickMeal[];
  }>({
    recents: [],
    favorites: [],
    yesterday: [],
  });
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [photoAvailable, setPhotoAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  // Voice-note recording (AI path): record a clip → send audio → draft. Only the
  // primary voice control when an online parser is built in (AI_CONFIGURED).
  const [recordingAvailable, setRecordingAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<ActiveRecording | null>(null);
  // Rolling buffer of recent mic amplitudes (0..1) feeding the live waveform.
  // Empty in Expo Go / no metering → the waveform renders a flat baseline.
  const [meterLevels, setMeterLevels] = useState<number[]>([]);
  const meterUnsubRef = useRef<(() => void) | null>(null);
  // Origin of the current draft, so the saved entry's `source` is honest.
  const [source, setSource] = useState<'text' | 'voice' | 'photo'>('text');
  const autoStarted = useRef(false);

  function setFreshDraft(d: MealDraft | null) {
    setDraft(d);
    setBaseGrams(d ? d.items.map((it) => it.grams) : []);
  }

  // Probe the on-device recognizer once; off-device this stays false and the
  // mic button never shows (text entry is the fallback). Stop on unmount.
  useEffect(() => {
    let active = true;
    const speech = getSpeechService();
    void speech.initialize().then((ok) => {
      if (active) setSpeechAvailable(ok);
    });
    void isPhotoCaptureAvailable().then((ok) => {
      if (active) setPhotoAvailable(ok);
    });
    setRecordingAvailable(isAudioRecordingAvailable());
    return () => {
      active = false;
      void speech.stop();
      void recRef.current?.cancel();
    };
  }, []);

  async function toggleListening() {
    const speech = getSpeechService();
    if (listening) {
      await speech.stop();
      setListening(false);
      return;
    }
    setFreshDraft(null);
    setSource('voice');
    setListening(true);
    await speech.listen(
      (transcript, isFinal) => {
        setText(transcript);
        if (isFinal) setListening(false);
      },
      // Always clear the listening state when the session ends, even with no
      // final result (no match / error / timeout / denied permission).
      () => setListening(false),
    );
  }

  // Honor a ?voice=1 deep-link once the recognizer is known to be available.
  useEffect(() => {
    if (voice === '1' && speechAvailable && !autoStarted.current) {
      autoStarted.current = true;
      void toggleListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, speechAvailable]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!db) return;
      const [settings, totals, quickAdd, variety] = await Promise.all([
        ensureSettings(db),
        todayMacroTotals(db),
        quickMeals(db),
        distinctFoodItemsToday(db),
      ]);
      if (!active) return;
      setProteinTarget(settings.targetProteinG);
      setTodayProteinG(totals.proteinG);
      setVarietyCount(variety);
      setHideCalories(settings.hideCalories);
      setRegionSetting(settings.region);
      setAiConsent(settings.aiFoodParseConsent);
      setAiConsentVersion(settings.aiFoodParseConsentVersion);
      setQuick(quickAdd);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  /// One tap re-loads a past meal as an already-confirmed draft (no parse) — the
  /// user still reviews and saves.
  function onQuickPick(meal: QuickMeal) {
    setText(meal.rawText);
    setSource('text');
    const item: NutritionItem = {
      name_ru: meal.rawText,
      name_en: meal.rawText,
      grams: 100,
      grams_source: 'confirmed',
      confidence: 1,
      per100: { source: 'history', kcal: meal.kcal, prot: meal.proteinG, fat: meal.fatG, carb: meal.carbG, minerals: {} },
      scaled: { kcal: meal.kcal, prot: meal.proteinG, fat: meal.fatG, carb: meal.carbG, minerals: {} },
      approximate: false,
    };
    setFreshDraft(recomputeDraft(region, [item]));
  }

  /// Run the text parse with a known consent value. `getFoodParser` only goes
  /// online when AI is configured AND consent is true; otherwise it's the stub.
  async function runTextParse(consentNow: boolean) {
    setParsing(true);
    try {
      setFreshDraft(await getFoodParser(consentNow).parse(text, region));
    } finally {
      setParsing(false);
    }
  }

  async function runPhotoParse(photo: PhotoInput, consentNow: boolean) {
    setParsing(true);
    try {
      setFreshDraft(await getFoodParser(consentNow).parsePhoto(photo, region));
    } finally {
      setParsing(false);
    }
  }

  async function runAudioParse(audio: AudioInput, consentNow: boolean) {
    setParsing(true);
    try {
      setFreshDraft(await getFoodParser(consentNow).parseAudio(audio, region));
    } finally {
      setParsing(false);
    }
  }

  /// Telegram-style voice note: tap to start recording, tap again to stop + send.
  /// On stop the clip goes to the AI parser (the model transcribes + identifies;
  /// numbers still come from the DB). The cross-border AI consent is the same
  /// one-time gate as text/photo.
  async function toggleRecording() {
    if (parsing || listening) return;
    if (recording) {
      const rec = recRef.current;
      recRef.current = null;
      meterUnsubRef.current?.();
      meterUnsubRef.current = null;
      setRecording(false);
      setMeterLevels([]);
      const audio = rec ? await rec.stop() : null;
      if (audio) await onAudio(audio);
      return;
    }
    setFreshDraft(null);
    const rec = await startRecording();
    if (!rec) return; // permission denied / module missing — stay on text/STT
    recRef.current = rec;
    setMeterLevels([]);
    // Live amplitude → rolling buffer for the waveform. No-op when the build has
    // no metering (Expo Go), so the bars just stay at their idle baseline.
    meterUnsubRef.current = rec.onMeter((level) => {
      setMeterLevels((prev) => pushLevel(prev, level, 24));
    });
    setSource('voice');
    setRecording(true);
  }

  async function onAudio(audio: AudioInput) {
    setSource('voice');
    if (AI_CONFIGURED && needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
      setPendingAudio(audio);
      setConsentPrompt('audio');
      return;
    }
    await runAudioParse(audio, aiConsent);
  }

  async function onParse() {
    if (text.trim().length === 0) return;
    // Just-in-time cross-border consent: only when an online parser exists and
    // the user hasn't already consented at the current version.
    if (AI_CONFIGURED && needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
      setConsentPrompt('text');
      return;
    }
    await runTextParse(aiConsent);
  }

  // Photo → downscale + EXIF strip → (consent) → backend vision → two-tier draft.
  async function onPhoto() {
    if (parsing || listening) return;
    const photo = await capturePhoto('camera');
    if (!photo) return;
    setSource('photo');
    if (AI_CONFIGURED && needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
      // Stronger, SEPARATE photo warning before the first photo→AI send (§C).
      setPendingPhoto(photo);
      setConsentPrompt('photo');
      return;
    }
    await runPhotoParse(photo, aiConsent);
  }

  /// One-tap, fully reversible comfort: hide or show calorie numbers. The
  /// setting already exists (default off) — this just makes it discoverable at
  /// the moment numbers appear, for anyone who'd rather not see them.
  async function onToggleHideCalories() {
    const next = !hideCalories;
    setHideCalories(next);
    if (db) await updateSettings(db, { hideCalories: next });
  }

  /// Accept on either consent modal: record the consent fact, flip local state,
  /// then resume the exact parse the user triggered — now online.
  async function onConsentAccept() {
    const kind = consentPrompt;
    setConsentPrompt(null);
    if (db) await grantAiConsent(db);
    setAiConsent(true);
    setAiConsentVersion(AI_CONSENT_VERSION);
    if (kind === 'photo') {
      const photo = pendingPhoto;
      setPendingPhoto(null);
      if (photo) await runPhotoParse(photo, true);
    } else if (kind === 'audio') {
      const audio = pendingAudio;
      setPendingAudio(null);
      if (audio) await runAudioParse(audio, true);
    } else if (kind === 'text') {
      await runTextParse(true);
    }
  }

  /// Decline: keep consent false and fall back to the offline stub for the same
  /// input, so the food-log flow still completes.
  async function onConsentDecline() {
    const kind = consentPrompt;
    setConsentPrompt(null);
    if (kind === 'photo') {
      const photo = pendingPhoto;
      setPendingPhoto(null);
      if (photo) await runPhotoParse(photo, false);
    } else if (kind === 'audio') {
      const audio = pendingAudio;
      setPendingAudio(null);
      if (audio) await runAudioParse(audio, false);
    } else if (kind === 'text') {
      await runTextParse(false);
    }
  }

  function onItemGrams(index: number, grams: number) {
    setDraft((prev) => (prev ? withItemGrams(prev, index, grams) : prev));
  }

  function onItemCookMethod(index: number, method: CookMethod) {
    setDraft((prev) => (prev ? withItemCookMethod(prev, index, method) : prev));
  }

  function onItemManualMacros(
    index: number,
    macros: { kcal: number; prot: number; fat: number; carb: number },
  ) {
    setDraft((prev) => (prev ? withItemManualMacros(prev, index, macros) : prev));
  }

  /// Discard the current result and return to the empty / quick-pick state. Without
  /// this, tapping a saved meal (or parsing) left no obvious way back (user
  /// feedback 2026-06-25: "не понятно как закрыть обратно").
  function onClearDraft() {
    setFreshDraft(null);
    setText('');
    setSavedAck(null);
    setSource('text');
  }

  async function onSave() {
    if (!draft || !db) return;
    setSaving(true);
    try {
      await saveParsedEntry(db, { rawText: text, source, draft });
      // Warm, rotating acknowledgment of the *act* of logging (SDT relatedness)
      // — never a score or a limit. Briefly shown, then we return to Home.
      setSavedAck(
        pickVariant(
          [
            t('food.savedWarm1'),
            t('food.savedWarm2'),
            t('food.savedWarm3'),
            t('food.savedWarm4'),
          ],
          saveSeedRef.current++,
        ),
      );
      // Land on the day's food list (not a bare back to Home) so the just-saved
      // entry is visibly there and can be reopened/edited. `replace` keeps the
      // log screen out of the back stack.
      setTimeout(() => router.replace('/food'), 1100);
    } catch {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <TextField
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (!listening) setSource('text');
        }}
        placeholder={t(`food.prompt.${mealPromptKeyForHour(new Date().getHours())}`)}
        multiline
        style={styles.input}
      />
      {/* Voice: the AI voice-note (record → send the clip → draft) is primary when
          an online parser is built in; otherwise the on-device STT mic fills the
          text field. */}
      {AI_CONFIGURED && recordingAvailable ? (
        <>
          {recording ? <Waveform levels={meterLevels} /> : null}
          <Pressable
            onPress={toggleRecording}
            disabled={parsing}
            style={({ pressed }) => [
              styles.micButton,
              {
                borderColor: recording ? theme.primary : theme.separator,
                backgroundColor: recording ? theme.primary : theme.card,
                opacity: pressed || parsing ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.micText, { color: recording ? theme.onPrimary : theme.primary }, theme.font.bodySemiBold]}>
              {recording ? t('food.voiceRecording') : t('food.voiceNote')}
            </Text>
          </Pressable>
          {parsing && source === 'voice' ? (
            <View style={styles.processingRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={[styles.micText, { color: theme.subtle }, theme.font.body]}>
                {t('food.voiceProcessing')}
              </Text>
            </View>
          ) : null}
        </>
      ) : speechAvailable ? (
        <Pressable
          onPress={toggleListening}
          style={({ pressed }) => [
            styles.micButton,
            {
              borderColor: listening ? theme.primary : theme.separator,
              backgroundColor: listening ? theme.primary : theme.card,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[styles.micText, { color: listening ? theme.onPrimary : theme.primary }, theme.font.bodySemiBold]}>
            {listening ? t('food.voiceListening') : t('food.voice')}
          </Text>
        </Pressable>
      ) : null}
      {photoAvailable ? (
        <Pressable
          onPress={onPhoto}
          disabled={parsing || listening || recording}
          style={({ pressed }) => [
            styles.micButton,
            { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed || parsing || listening || recording ? 0.6 : 1 },
          ]}
        >
          <Text style={[styles.micText, { color: theme.primary }, theme.font.bodySemiBold]}>{t('food.photo')}</Text>
        </Pressable>
      ) : null}
      <PrimaryButton
        label={parsing ? t('food.parsing') : t('food.parse')}
        onPress={onParse}
        disabled={parsing || listening || recording || text.trim().length === 0}
      />

      {draft == null &&
      (quick.favorites.length > 0 || quick.recents.length > 0 || quick.yesterday.length > 0) ? (
        <View style={styles.quick}>
          {(
            [
              { label: t('food.sameAsYesterday'), meals: quick.yesterday },
              { label: t('food.favorites'), meals: quick.favorites },
              { label: t('food.recent'), meals: quick.recents },
            ] as const
          ).map((group) =>
            group.meals.length === 0 ? null : (
              <View key={group.label} style={styles.quickGroup}>
                <Text style={[styles.quickLabel, { color: theme.subtle }, theme.font.heading]}>
                  {group.label.toUpperCase()}
                </Text>
                <View style={styles.quickWrap}>
                  {group.meals.map((m, i) => (
                    <Pressable
                      key={i}
                      onPress={() => onQuickPick(m)}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: theme.card, borderColor: theme.separator, opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text numberOfLines={1} style={[styles.chipText, { color: theme.text }, theme.font.bodySemiBold]}>
                        {m.rawText}
                      </Text>
                      <Text style={[styles.chipMacro, { color: theme.subtle }, theme.font.body]}>
                        {t('macros.protein')} {Math.round(m.proteinG)} {t('units.g')}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ),
          )}
        </View>
      ) : null}

      {draft == null ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.empty')}</Text>
      ) : draft.items.length === 0 ? (
        <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.needHelp')}</Text>
      ) : (
        <View style={styles.results}>
          {draft.items.map((item, i) => (
            <ItemCard
              key={i}
              item={item}
              baseGrams={baseGrams[i] ?? item.grams}
              hideCalories={hideCalories}
              theme={theme}
              onGrams={(g) => onItemGrams(i, g)}
              onCookMethod={(m) => onItemCookMethod(i, m)}
              onManualMacros={(m) => onItemManualMacros(i, m)}
            />
          ))}

          <Card style={[styles.totalCard, { borderColor: theme.separator }]}>
            <View style={styles.totalHead}>
              <Text style={[styles.totalLabel, { color: theme.text }, theme.font.bodySemiBold]}>{t('food.total')}</Text>
              {draft.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
            </View>
            <Text style={[styles.totalValue, { color: theme.text }, theme.font.bodyMedium]}>
              {hideCalories
                ? `${t('macros.protein')} ${draft.totals.prot} ${t('units.g')}`
                : `${draft.totals.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${draft.totals.prot} ${t('units.g')} · ${t('macros.fat')} ${draft.totals.fat} · ${t('macros.carbs')} ${draft.totals.carb}`}
            </Text>
            <Pressable onPress={onToggleHideCalories} hitSlop={8} style={styles.hideCaloriesToggle}>
              <Text style={[styles.hideCaloriesText, { color: theme.subtle }, theme.font.body]}>
                {hideCalories ? t('food.showCalories') : t('food.hideCalories')}
              </Text>
            </Pressable>
            {draft.approximate ? (
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('food.disclaimer')}</Text>
            ) : null}
            {draft.flags.has_estimate ? (
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('food.estimateNote')}</Text>
            ) : null}
          </Card>

          {proteinTarget > 0 ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }, theme.font.body]}>
              {proteinInsight(todayProteinG + draft.totals.prot, proteinTarget, Math.round(todayProteinG))}
            </Text>
          ) : null}
          {varietyCount > 0 ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }, theme.font.body]}>
              {varietyInsight(varietyCount)}
            </Text>
          ) : null}
          {savedAck ? (
            <Text style={[styles.savedAck, { color: theme.accent }, theme.font.bodyMedium]}>
              {`${savedAck} ✓`}
            </Text>
          ) : null}
          <PrimaryButton
            label={saving ? t('food.saving') : t('food.save')}
            onPress={onSave}
            disabled={saving || db == null}
          />
          <Pressable onPress={onClearDraft} disabled={saving} hitSlop={8} style={styles.clearBtn}>
            <Text style={[styles.clearText, { color: theme.subtle }, theme.font.body]}>{t('food.clear')}</Text>
          </Pressable>
          {db == null ? (
            <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.dbUnavailable')}</Text>
          ) : null}
        </View>
      )}

      <ConsentModal
        visible={consentPrompt === 'text' || consentPrompt === 'audio'}
        title={t('consent.ai.title')}
        body={t('consent.ai.body')}
        confirmLabel={t('consent.ai.accept')}
        declineLabel={t('consent.ai.decline')}
        declineCaption={t('consent.ai.declineCaption')}
        onConfirm={onConsentAccept}
        onDecline={onConsentDecline}
      />
      <ConsentModal
        visible={consentPrompt === 'photo'}
        title={t('consent.photo.title')}
        body={t('consent.photo.body')}
        confirmLabel={t('consent.photo.confirm')}
        declineLabel={t('consent.photo.cancel')}
        onConfirm={onConsentAccept}
        onDecline={onConsentDecline}
      />
    </Screen>
  );
}

function ApproxBadge({ theme, label }: { theme: Theme; label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: theme.card, borderColor: theme.primary }]}>
      <Text style={[styles.badgeText, { color: theme.primary }, theme.font.bodySemiBold]}>{label}</Text>
    </View>
  );
}

function mineralLine(item: NutritionItem, t: (k: string) => string): string {
  const parts: string[] = [];
  for (const key of MINERAL_KEYS) {
    const v = item.per100.minerals[key];
    if (typeof v === 'number' && v > 0) parts.push(`${t(`food.minerals.${key}`)} ${Math.round(v)}`);
  }
  return parts.join(' · ');
}

function ItemCard({
  item,
  baseGrams,
  hideCalories,
  theme,
  onGrams,
  onCookMethod,
  onManualMacros,
}: {
  item: NutritionItem;
  baseGrams: number;
  hideCalories: boolean;
  theme: Theme;
  onGrams: (grams: number) => void;
  onCookMethod: (method: CookMethod) => void;
  onManualMacros: (macros: { kcal: number; prot: number; fat: number; carb: number }) => void;
}) {
  const { t } = useTranslation();
  const minerals = mineralLine(item, t);
  const activeMethod: CookMethod = item.cook_method ?? 'raw';
  // A full DB miss: the resolver's coarse placeholder. We show NO fabricated
  // numbers for it — only an honest "not in our database" + manual entry.
  const isMiss = item.per100.source === 'estimate';
  const presets: { label: string; grams: number }[] = [
    { label: t('food.presetLess'), grams: Math.max(5, Math.round(baseGrams * 0.6)) },
    { label: t('food.presetMid'), grams: Math.max(5, Math.round(baseGrams)) },
    { label: t('food.presetMore'), grams: Math.max(5, Math.round(baseGrams * 1.6)) },
  ];

  return (
    <Card style={styles.item}>
      <Text style={[styles.itemName, { color: theme.text }, theme.font.bodySemiBold]}>{item.name_ru}</Text>

      {isMiss ? (
        /* DB miss → never render the placeholder macros. State it plainly and
           let the user supply real per-100g numbers below. */
        <Text style={[styles.notInDb, { color: theme.subtle }, theme.font.body]}>{t('food.notInDb')}</Text>
      ) : (
        <>
          {/* Per-100g composition — EXACT (DB) or user-entered (manual). */}
          <Text style={[styles.per100Label, { color: theme.subtle }, theme.font.body]}>
            {t('food.per100')} · {t(`food.source.${item.per100.source}`)}
          </Text>
          <Text style={[styles.per100Value, { color: theme.text }, theme.font.body]}>
            {hideCalories
              ? `${t('macros.protein')} ${item.per100.prot} · ${t('macros.fat')} ${item.per100.fat} · ${t('macros.carbs')} ${item.per100.carb}`
              : `${item.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${item.per100.prot} · ${t('macros.fat')} ${item.per100.fat} · ${t('macros.carbs')} ${item.per100.carb}`}
          </Text>
          {minerals.length > 0 ? (
            <Text style={[styles.minerals, { color: theme.subtle }, theme.font.body]}>{minerals}</Text>
          ) : null}
        </>
      )}

      {/* Manual per-100g entry for a DB miss (and editing once entered). */}
      {isMiss || item.per100.source === 'manual' ? (
        <ManualMacros item={item} isMiss={isMiss} theme={theme} onManualMacros={onManualMacros} />
      ) : null}

      {/* Cooking method — neutral chips ("how it was cooked"), never framed as
          healthier/worse. A non-baseline method coarsely adjusts kcal/fat and is
          shown as approximate. Offline, deterministic. */}
      <View style={styles.cookRow}>
        <Text style={[styles.gramsLabel, { color: theme.subtle }, theme.font.body]}>
          {t('food.cookMethod.label')}
        </Text>
        <View style={styles.cookChips}>
          {COOK_METHODS.map((m) => {
            const active = activeMethod === m;
            return (
              <Pressable
                key={m}
                onPress={() => onCookMethod(m)}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    backgroundColor: active ? theme.primary : theme.card,
                    borderColor: active ? theme.primary : theme.separator,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.presetText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                  {t(`food.cookMethod.${m}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Confirm grams → flips the item out of "approximate". */}
      <View style={styles.gramsRow}>
        <Text style={[styles.gramsLabel, { color: theme.subtle }, theme.font.body]}>{t('food.grams')}</Text>
        <View style={styles.presets}>
          {presets.map((p) => {
            const active = Math.round(item.grams) === p.grams;
            return (
              <Pressable
                key={p.label}
                onPress={() => onGrams(p.grams)}
                style={({ pressed }) => [
                  styles.preset,
                  {
                    backgroundColor: active ? theme.primary : theme.card,
                    borderColor: active ? theme.primary : theme.separator,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.presetText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          value={String(Math.round(item.grams))}
          onChangeText={(v) => onGrams(toNumber(v))}
          keyboardType="numeric"
          style={styles.gramsInput}
        />
        <Text style={[styles.gramsUnit, { color: theme.subtle }, theme.font.body]}>{t('units.g')}</Text>
      </View>

      {/* Scaled component total — hidden on a DB miss (the placeholder total is
          fabricated too); it appears once the user enters real macros. */}
      {isMiss ? null : (
        <View style={styles.itemTotalRow}>
          <Text style={[styles.itemTotal, { color: theme.text }, theme.font.bodyMedium]}>
            {hideCalories
              ? `${t('macros.protein')} ${item.scaled.prot} ${t('units.g')}`
              : `${item.scaled.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${item.scaled.prot} ${t('units.g')}`}
          </Text>
          {item.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
        </View>
      )}
    </Card>
  );
}

/// Per-100g macro entry for a DB miss (and editing it afterwards). Keeps its own
/// input strings so partial typing isn't clobbered by re-renders; every change
/// pushes the parsed macros up via `onManualMacros` (→ source becomes 'manual').
function ManualMacros({
  item,
  isMiss,
  theme,
  onManualMacros,
}: {
  item: NutritionItem;
  isMiss: boolean;
  theme: Theme;
  onManualMacros: (macros: { kcal: number; prot: number; fat: number; carb: number }) => void;
}) {
  const { t } = useTranslation();
  // Seed from the current per100 when the user is editing already-entered manual
  // macros; blank on a fresh miss so nothing fabricated is shown.
  const init = (n: number) => (isMiss ? '' : String(n));
  const [kcal, setKcal] = useState(init(item.per100.kcal));
  const [prot, setProt] = useState(init(item.per100.prot));
  const [fat, setFat] = useState(init(item.per100.fat));
  const [carb, setCarb] = useState(init(item.per100.carb));

  function push(next: { kcal: string; prot: string; fat: string; carb: string }) {
    onManualMacros({
      kcal: toNumber(next.kcal),
      prot: toNumber(next.prot),
      fat: toNumber(next.fat),
      carb: toNumber(next.carb),
    });
  }

  const fields: { key: 'kcal' | 'prot' | 'fat' | 'carb'; label: string; value: string; set: (v: string) => void }[] = [
    { key: 'kcal', label: t('units.kcal'), value: kcal, set: setKcal },
    { key: 'prot', label: t('macros.protein'), value: prot, set: setProt },
    { key: 'fat', label: t('macros.fat'), value: fat, set: setFat },
    { key: 'carb', label: t('macros.carbs'), value: carb, set: setCarb },
  ];

  return (
    <View style={styles.manualWrap}>
      <Text style={[styles.manualLabel, { color: theme.subtle }, theme.font.body]}>{t('food.enterMacros')}</Text>
      <View style={styles.manualRow}>
        {fields.map((f) => (
          <View key={f.key} style={styles.manualField}>
            <Text style={[styles.manualFieldLabel, { color: theme.subtle }, theme.font.body]}>{f.label}</Text>
            <TextField
              value={f.value}
              onChangeText={(v) => {
                f.set(v);
                push({ kcal, prot, fat, carb, [f.key]: v });
              }}
              keyboardType="numeric"
              placeholder="0"
              style={styles.manualInput}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

function toNumber(v: string): number {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
  micButton: { borderRadius: 999, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  micText: { fontSize: 15 },
  processingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  clearBtn: { alignSelf: 'center', marginTop: 12, paddingVertical: 4 },
  clearText: { fontSize: 13, textDecorationLine: 'underline' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  results: { marginTop: 16 },
  item: { marginBottom: 10 },
  itemName: { fontSize: 15, marginBottom: 6 },
  per100Label: { fontSize: 11, marginBottom: 2 },
  per100Value: { fontSize: 13, marginBottom: 2 },
  minerals: { fontSize: 11, marginBottom: 8, lineHeight: 16 },
  cookRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  cookChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flexShrink: 1 },
  notInDb: { fontSize: 13, marginBottom: 6, lineHeight: 18 },
  manualWrap: { marginTop: 4, marginBottom: 4 },
  manualLabel: { fontSize: 12, marginBottom: 6 },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualField: { flex: 1 },
  manualFieldLabel: { fontSize: 11, marginBottom: 2 },
  manualInput: { textAlign: 'center' },
  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  gramsLabel: { fontSize: 12 },
  presets: { flexDirection: 'row', gap: 6 },
  preset: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  presetText: { fontSize: 12 },
  gramsInput: { width: 64, paddingVertical: 8, fontSize: 14, textAlign: 'center' },
  gramsUnit: { fontSize: 12 },
  itemTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  itemTotal: { fontSize: 14 },
  totalCard: { marginTop: 4, marginBottom: 8 },
  totalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  totalLabel: { fontSize: 15 },
  totalValue: { fontSize: 14 },
  hideCaloriesToggle: { marginTop: 8, alignSelf: 'flex-start' },
  hideCaloriesText: { fontSize: 12, textDecorationLine: 'underline' },
  disclaimer: { fontSize: 11, marginTop: 8, lineHeight: 16 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11 },
  proteinNote: { fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  savedAck: { fontSize: 13, marginTop: 4, marginBottom: 10, textAlign: 'center', lineHeight: 18 },
  quick: { marginTop: 16 },
  quickGroup: { marginBottom: 14 },
  quickLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 8 },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 14, maxWidth: 240 },
  chipMacro: { fontSize: 11, marginTop: 2 },
});
