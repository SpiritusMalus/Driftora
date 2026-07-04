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
import { loadRememberedChoices, rememberFoodChoice } from '@/lib/core/db/foodChoices';
import { applyRememberedChoices, lookupNameForItem } from '@/lib/core/services/foodChoice';
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
import type { AudioInput, MealDraft, NutrientValues, NutritionAlternative, NutritionItem, PhotoInput, Region } from '@/lib/core/services/foodParser';
import { nutrientDetailRows } from '@/lib/core/insights/nutrientDetail';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import { recomputeDraft, withItemAlternative, withItemCookMethod, withItemGrams, withItemManualMacros, withItemReplacement } from '@/lib/core/services/mealDraft';
import { COOK_METHODS, cookMethodApplies, type CookMethod } from '@/lib/core/insights/cookMethod';
import { capturePhoto, isPhotoCaptureAvailable } from '@/lib/core/services/photoProvider';
import { getSpeechService } from '@/lib/core/services/speechProvider';
import { type Theme, useTheme } from '@/lib/theme/theme';

/// Whether an online AI parser is even configured for this build. Consent and
/// the on-screen AI notice only matter when it is — otherwise everything is
/// offline and nothing can leave the device.
const AI_CONFIGURED = !!process.env.EXPO_PUBLIC_FOOD_API_URL;


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
  // Today's protein-so-far + personal target, for the honest "what it means"
  // line shown once a meal is parsed (the meaning-rules library).
  const [proteinTarget, setProteinTarget] = useState(0);
  const [todayProteinG, setTodayProteinG] = useState(0);
  const [varietyCount, setVarietyCount] = useState(0);
  // «Пауза» mutes ALL target pressure — including the protein line below.
  const [paused, setPaused] = useState(false);
  // Honest parse status: 'offline' = the server didn't answer and the offline
  // stub filled in (degraded numbers, no AI); 'failed' = the parse itself threw.
  const [parseIssue, setParseIssue] = useState<'offline' | 'failed' | null>(null);
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
  // Why on-device recognition last failed (localized) — shown under the mic so a
  // dropped session explains itself instead of silently resetting. Cleared on a
  // new attempt and whenever the user edits the text.
  const [voiceError, setVoiceError] = useState<string | null>(null);
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
    setVoiceError(null);
    setSource('voice');
    setListening(true);
    await speech.listen(
      (transcript, isFinal) => {
        setText(transcript);
        if (isFinal) setListening(false);
      },
      // Session ended: always reset the listening UI. On a failure, explain why
      // instead of silently resetting — and we deliberately DON'T clear `text`,
      // so any words already transcribed survive for the user to edit + Parse.
      (reason) => {
        setListening(false);
        if (reason) setVoiceError(t(`food.voiceError.${reason.code}`));
      },
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
      setPaused(settings.paused);
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
    setParseIssue(null);
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
  // Re-apply the user's remembered per-food corrections (disambiguation layer 2)
  // to a freshly parsed draft, so a fix made once sticks on the next log.
  async function applyMemory(draft: MealDraft): Promise<MealDraft> {
    if (!db) return draft;
    const choices = await loadRememberedChoices(db, region, draft);
    return applyRememberedChoices(draft, region, choices);
  }

  /// After any parse: surface HOW the draft was produced. `offline_fallback`
  /// means the user expected the online parser and silently got the stub — say
  /// so instead of passing degraded numbers off as an AI parse. Only flagged
  /// when online was actually expected (AI configured + consented).
  function acceptDraft(parsed: MealDraft, consentNow: boolean) {
    setFreshDraft(parsed);
    setParseIssue(AI_CONFIGURED && consentNow && parsed.flags.offline_fallback ? 'offline' : null);
  }

  async function runTextParse(consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    try {
      acceptDraft(await applyMemory(await getFoodParser(consentNow).parse(text, region)), consentNow);
    } catch {
      // A throw here is not the network (that falls back inside the parser) —
      // it's something local (db read). Still: never fail into silence.
      setParseIssue('failed');
    } finally {
      setParsing(false);
    }
  }

  async function runPhotoParse(photo: PhotoInput, consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    try {
      acceptDraft(await applyMemory(await getFoodParser(consentNow).parsePhoto(photo, region)), consentNow);
    } catch {
      setParseIssue('failed');
    } finally {
      setParsing(false);
    }
  }

  async function runAudioParse(audio: AudioInput, consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    try {
      acceptDraft(await applyMemory(await getFoodParser(consentNow).parseAudio(audio, region)), consentNow);
    } catch {
      setParseIssue('failed');
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

  function onItemSelectAlternative(index: number, altIndex: number) {
    setDraft((prev) => (prev ? withItemAlternative(prev, index, altIndex) : prev));
  }

  // Manual DB search for one item ("найти вручную") and the swap when the user
  // picks a result. Search uses the active parser (online when consented, else
  // the offline stub which returns nothing).
  function onItemSearch(query: string): Promise<NutritionAlternative[]> {
    return getFoodParser(aiConsent).searchFoods(query, region);
  }
  function onItemReplace(index: number, replacement: NutritionAlternative) {
    setDraft((prev) => (prev ? withItemReplacement(prev, index, replacement) : prev));
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
    setParseIssue(null);
  }

  async function onSave() {
    if (!draft || !db) return;
    setSaving(true);
    try {
      await saveParsedEntry(db, { rawText: text, source, draft });
      // Remember every match the user explicitly corrected (swap / manual search),
      // so the same food resolves to their choice next time (layer 2). Skip DB
      // misses — their placeholder per-100g isn't a real, re-appliable fact.
      for (const it of draft.items) {
        if (it.userChosen && it.per100.source !== 'estimate') {
          await rememberFoodChoice(db, region, lookupNameForItem(it, region), { name: it.name_ru, per100: it.per100 });
        }
      }
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
          if (voiceError) setVoiceError(null);
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
      {voiceError && !listening ? (
        <Text style={[styles.voiceError, { color: theme.subtle }, theme.font.body]}>{voiceError}</Text>
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
      {/* Never fail into silence: say the server didn't answer (offline stub
          filled in) or that the parse broke — the button above IS the retry. */}
      {parseIssue ? (
        <Text style={[styles.parseIssue, { color: theme.subtle }, theme.font.body]}>
          {t(parseIssue === 'offline' ? 'food.parseIssue.offline' : 'food.parseIssue.failed')}
        </Text>
      ) : null}

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
              hideCalories={hideCalories}
              theme={theme}
              onGrams={(g) => onItemGrams(i, g)}
              onCookMethod={(m) => onItemCookMethod(i, m)}
              onManualMacros={(m) => onItemManualMacros(i, m)}
              onSelectAlternative={(altIndex) => onItemSelectAlternative(i, altIndex)}
              onSearch={onItemSearch}
              onReplace={(alt) => onItemReplace(i, alt)}
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
            {/* Meal-level extended composition — an honest partial sum. */}
            <NutrientDetail values={draft.totals} caption={t('food.detail.totalsNote')} theme={theme} />
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

          {/* «Пауза» promises "цели выключены" — honour it here too, not only
              on Home (the banner alone doesn't stop this line from nagging). */}
          {proteinTarget > 0 && !paused ? (
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

/// Expandable extended-composition block (fiber/sugar/sat. fat + minerals) for
/// a scaled nutrient set. Renders nothing when the source gave only КБЖУ —
/// we never pad the list with zeros the DB didn't state (HONESTY RULE).
function NutrientDetail({
  values,
  caption,
  theme,
}: {
  values: NutrientValues;
  caption: string;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rows = nutrientDetailRows(values);
  if (rows.length === 0) return null;
  return (
    <View style={styles.altWrap}>
      <Pressable onPress={() => setOpen((s) => !s)} hitSlop={6}>
        <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
          {open ? t('food.detail.hide') : t('food.detail.show')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailBox}>
          {rows.map((r) => (
            <View key={r.key} style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: theme.subtle }, theme.font.body]}>
                {t(`food.detail.label.${r.key}`)}
              </Text>
              <Text style={[styles.detailValue, { color: theme.text }, theme.font.bodyMedium]}>
                {r.value} {t(`food.detail.unit.${r.unit}`)}
              </Text>
            </View>
          ))}
          <Text style={[styles.detailCaption, { color: theme.subtle }, theme.font.body]}>{caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ItemCard({
  item,
  hideCalories,
  theme,
  onGrams,
  onCookMethod,
  onManualMacros,
  onSelectAlternative,
  onSearch,
  onReplace,
}: {
  item: NutritionItem;
  hideCalories: boolean;
  theme: Theme;
  onGrams: (grams: number) => void;
  onCookMethod: (method: CookMethod) => void;
  onManualMacros: (macros: { kcal: number; prot: number; fat: number; carb: number }) => void;
  onSelectAlternative: (altIndex: number) => void;
  onSearch: (query: string) => Promise<NutritionAlternative[]>;
  onReplace: (replacement: NutritionAlternative) => void;
}) {
  const { t } = useTranslation();
  const activeMethod: CookMethod = item.cook_method ?? 'raw';
  // Drinks are consumed as-is — no "how it was cooked" row for them.
  const cookable = cookMethodApplies(item.name_ru, item.name_en);
  // The "per 100 g · <source>" line always shows the DB row itself (that's the
  // promise in the footnote); a cook-method adjustment only moves the totals.
  const dbPer100 = item.basePer100 ?? item.per100;
  // A full DB miss: the resolver's coarse placeholder. We show NO fabricated
  // numbers for it — only an honest "not in our database" + manual entry.
  const isMiss = item.per100.source === 'estimate';
  // Other DB matches the user can switch to. Low confidence in the auto-pick
  // opens the list proactively; otherwise it hides behind a "не то?" toggle.
  const alternatives = item.alternatives ?? [];
  const [showAlts, setShowAlts] = useState(item.confidence < 0.5);
  // Manual DB search ("найти вручную"): query field + ranked results.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<NutritionAlternative[] | null>(null);

  async function runSearch() {
    const q = searchText.trim();
    if (q.length === 0) return;
    setSearching(true);
    try {
      setSearchResults(await onSearch(q));
    } finally {
      setSearching(false);
    }
  }

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
              ? `${t('macros.protein')} ${dbPer100.prot} · ${t('macros.fat')} ${dbPer100.fat} · ${t('macros.carbs')} ${dbPer100.carb}`
              : `${dbPer100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${dbPer100.prot} · ${t('macros.fat')} ${dbPer100.fat} · ${t('macros.carbs')} ${dbPer100.carb}`}
          </Text>
          {/* Fiber/sugar/sat-fat + minerals, scaled to the chosen weight. */}
          <NutrientDetail
            values={item.scaled}
            caption={t('food.detail.basis', { grams: Math.round(item.grams) })}
            theme={theme}
          />
        </>
      )}

      {/* "не то?" — switch to another DB match. Shown only when the source
          returned runners-up; opens proactively on a low-confidence auto-pick. */}
      {!isMiss && alternatives.length > 0 ? (
        <View style={styles.altWrap}>
          <Pressable onPress={() => setShowAlts((s) => !s)} hitSlop={6}>
            <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
              {showAlts ? t('food.alternatives.hide') : t('food.alternatives.prompt')}
            </Text>
          </Pressable>
          {showAlts ? (
            <View style={styles.altList}>
              {alternatives.map((alt, j) => (
                <Pressable
                  key={`${alt.name}-${j}`}
                  onPress={() => onSelectAlternative(j)}
                  style={({ pressed }) => [
                    styles.altRow,
                    { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[styles.altName, { color: theme.text }, theme.font.body]} numberOfLines={1}>
                    {alt.name}
                  </Text>
                  <Text style={[styles.altMacros, { color: theme.subtle }, theme.font.body]}>
                    {hideCalories
                      ? `${t('macros.protein')} ${alt.per100.prot}`
                      : `${alt.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${alt.per100.prot}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* "найти вручную" — search the DB and replace this item with a real
          match. Especially useful on a miss or a wrong auto-pick. */}
      <View style={styles.altWrap}>
        <Pressable onPress={() => setSearchOpen((s) => !s)} hitSlop={6}>
          <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
            {searchOpen ? t('food.manualSearch.hide') : t('food.manualSearch.open')}
          </Text>
        </Pressable>
        {searchOpen ? (
          <View style={styles.altList}>
            <View style={styles.searchRow}>
              <TextField
                value={searchText}
                onChangeText={setSearchText}
                onSubmitEditing={runSearch}
                placeholder={t('food.manualSearch.placeholder')}
                style={styles.searchInput}
              />
              <Pressable
                onPress={runSearch}
                disabled={searching || searchText.trim().length === 0}
                style={({ pressed }) => [
                  styles.searchBtn,
                  { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed || searching ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.cookChipText, { color: theme.primary }, theme.font.body]}>
                  {searching ? t('food.manualSearch.searching') : t('food.manualSearch.action')}
                </Text>
              </Pressable>
            </View>
            {searchResults != null && searchResults.length === 0 && !searching ? (
              <Text style={[styles.altMacros, { color: theme.subtle }, theme.font.body]}>
                {t('food.manualSearch.empty')}
              </Text>
            ) : null}
            {(searchResults ?? []).map((alt, j) => (
              <Pressable
                key={`s-${alt.name}-${j}`}
                onPress={() => {
                  onReplace(alt);
                  setSearchOpen(false);
                  setSearchResults(null);
                  setSearchText('');
                }}
                style={({ pressed }) => [
                  styles.altRow,
                  { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.altName, { color: theme.text }, theme.font.body]} numberOfLines={1}>
                  {alt.name}
                </Text>
                <Text style={[styles.altMacros, { color: theme.subtle }, theme.font.body]}>
                  {hideCalories
                    ? `${t('macros.protein')} ${alt.per100.prot}`
                    : `${alt.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${alt.per100.prot}`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* Manual per-100g entry for a DB miss (and editing once entered). */}
      {isMiss || item.per100.source === 'manual' ? (
        <ManualMacros item={item} isMiss={isMiss} theme={theme} onManualMacros={onManualMacros} />
      ) : null}

      {/* Cooking method — neutral chips ("how it was cooked"), never framed as
          healthier/worse. A non-baseline method coarsely adjusts kcal/fat and is
          shown as approximate. Offline, deterministic. Hidden for drinks. */}
      {cookable ? (
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
                    styles.cookChip,
                    {
                      backgroundColor: active ? theme.primary : theme.card,
                      borderColor: active ? theme.primary : theme.separator,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.cookChipText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                    {t(`food.cookMethod.${m}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Confirm grams → flips the item out of "approximate". The exact weight
          input is the whole control now (the S/M/L presets were redundant). */}
      <View style={styles.gramsRow}>
        <Text style={[styles.gramsLabel, { color: theme.subtle }, theme.font.body]}>{t('food.grams')}</Text>
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
  voiceError: { fontSize: 13, textAlign: 'center', marginTop: -2, marginBottom: 8, lineHeight: 18 },
  altWrap: { marginTop: 8 },
  altToggle: { fontSize: 13 },
  altList: { gap: 6, marginTop: 6 },
  altRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  altName: { fontSize: 13, flex: 1 },
  altMacros: { fontSize: 12 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1 },
  searchBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  processingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  clearBtn: { alignSelf: 'center', marginTop: 12, paddingVertical: 4 },
  clearText: { fontSize: 13, textDecorationLine: 'underline' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  results: { marginTop: 16 },
  item: { marginBottom: 10 },
  itemName: { fontSize: 15, marginBottom: 6 },
  per100Label: { fontSize: 11, marginBottom: 2 },
  per100Value: { fontSize: 13, marginBottom: 2 },
  detailBox: { marginTop: 6, gap: 3 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12 },
  detailCaption: { fontSize: 10, fontStyle: 'italic', marginTop: 4, lineHeight: 14 },
  cookRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  cookChips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', flexShrink: 1 },
  cookChip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  cookChipText: { fontSize: 12 },
  notInDb: { fontSize: 13, marginBottom: 6, lineHeight: 18 },
  manualWrap: { marginTop: 4, marginBottom: 4 },
  manualLabel: { fontSize: 12, marginBottom: 6 },
  manualRow: { flexDirection: 'row', gap: 8 },
  manualField: { flex: 1 },
  manualFieldLabel: { fontSize: 11, marginBottom: 2 },
  manualInput: { textAlign: 'center' },
  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  gramsLabel: { fontSize: 12 },
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
  parseIssue: { fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  savedAck: { fontSize: 13, marginTop: 4, marginBottom: 10, textAlign: 'center', lineHeight: 18 },
  quick: { marginTop: 16 },
  quickGroup: { marginBottom: 14 },
  quickLabel: { fontSize: 11, letterSpacing: 1.2, marginBottom: 8 },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 14, maxWidth: 240 },
  chipMacro: { fontSize: 11, marginTop: 2 },
});
