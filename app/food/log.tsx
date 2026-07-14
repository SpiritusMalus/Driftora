import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { MealChips } from '@/components/food/MealChips';
import { Card } from '@/components/ui/Card';
import { FillBar } from '@/components/ui/FillBar';
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
import {
  listFoodChoices,
  loadRememberedChoices,
  rememberFoodChoice,
  type RememberedFood,
} from '@/lib/core/db/foodChoices';
import {
  applyRememberedChoices,
  displayItemName,
  lookupNameForItem,
  normalizeChoiceName,
} from '@/lib/core/services/foodChoice';
import { deleteTempFile } from '@/lib/core/services/tempFiles';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { mealPromptKeyForHour } from '@/lib/core/insights/mealPrompt';
import { mealTypeForEntry, type MealType } from '@/lib/core/insights/mealType';
import { proteinInsight } from '@/lib/core/insights/proteinInsight';
import { pickVariant } from '@/lib/core/insights/variant';
import { varietyInsight } from '@/lib/core/insights/varietyInsight';
import {
  isAudioRecordingAvailable,
  isSilentRecording,
  startRecording,
  type ActiveRecording,
} from '@/lib/core/services/audioRecorder';
import type { AudioInput, MealDraft, NutrientValues, NutritionAlternative, NutritionItem, PhotoInput, Region } from '@/lib/core/services/foodParser';
import { nutrientDetailRows } from '@/lib/core/insights/nutrientDetail';
import { dailyMicroNorms, type MicroRow } from '@/lib/core/insights/microNutrients';
import type { Sex } from '@/lib/core/insights/bodyMetrics';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import { recomputeDraft, scaleToGrams, withItemAlternative, withItemGrams, withItemManualMacros, withItemReplacement } from '@/lib/core/services/mealDraft';
import { capturePhoto, isPhotoCaptureAvailable, type PhotoSource } from '@/lib/core/services/photoProvider';
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
  // Meal-of-day chips: the clock (or a typed «завтрак…») preselects, the user's
  // tap decides — their pick is stored with the entry so a late breakfast never
  // gets filed under «Обед» by the clock (device feedback 2026-07-10).
  const [meal, setMeal] = useState<MealType | null>(null);
  // Today's protein-so-far + personal target, for the honest "what it means"
  // line shown once a meal is parsed (the meaning-rules library).
  const [proteinTarget, setProteinTarget] = useState(0);
  const [todayProteinG, setTodayProteinG] = useState(0);
  // Profile sex, for the per-dish micro "% of daily norm" scales (iron and some
  // vitamins differ by sex). '' → the bars show both figures instead of guessing.
  const [sex, setSex] = useState<'' | Sex>('');
  const [varietyCount, setVarietyCount] = useState(0);
  // «Пауза» mutes ALL target pressure — including the protein line below.
  const [paused, setPaused] = useState(false);
  // Honest parse status, ONE message per outcome (the old code stacked
  // «разобрано офлайн» over «не удалось распознать» — contradictory, device
  // feedback 2026-07-12): 'offline' = server silent, the offline table still
  // produced items (rougher numbers); 'offlineEmpty' = server silent AND the
  // offline table knows nothing of this text; 'offlineMedia' = photo/voice
  // can't be parsed offline at all; 'failed' = the parse itself threw locally.
  const [parseIssue, setParseIssue] = useState<
    'offline' | 'offlineEmpty' | 'offlineMedia' | 'failed' | null
  >(null);
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
  // The user's «рацион»: individual foods they've confirmed before (per-food
  // memory), for the quick "pick what I eat + type grams" flow. Distinct from
  // `quick` above (whole past MEALS from entries) — this is per-food, grams-editable.
  const [myDiet, setMyDiet] = useState<RememberedFood[]>([]);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  // True once the recognizer probe RESOLVED (either way) — lets the ?voice=1
  // deep-link tell "still probing" apart from "voice truly unavailable".
  const [speechProbed, setSpeechProbed] = useState(false);
  const [photoAvailable, setPhotoAvailable] = useState(false);
  // Why the last camera/gallery attempt produced nothing (localized) — an
  // undecodable file must explain itself instead of a silently dead button.
  const [photoError, setPhotoError] = useState<string | null>(null);
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
  // The `?voice=<token>` value we've already acted on. A fresh token (each Home
  // mic tap sends a unique one) re-triggers voice; probes resolving mid-flight
  // don't re-fire the same token. Replaces a plain boolean that couldn't tell a
  // new deep-link from a re-render.
  const consumedVoiceToken = useRef<string | null>(null);

  function setFreshDraft(d: MealDraft | null) {
    setDraft(d);
  }

  // Probe the on-device recognizer once; off-device this stays false and the
  // mic button never shows (text entry is the fallback). Stop on unmount.
  useEffect(() => {
    let active = true;
    const speech = getSpeechService();
    void speech.initialize().then((ok) => {
      if (active) {
        setSpeechAvailable(ok);
        setSpeechProbed(true);
      }
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

  // Honor a ?voice=1 deep-link (the Home mic) by starting whichever voice mode
  // this build actually offers as PRIMARY: the AI voice note first, on-device
  // dictation as the fallback. The old effect only knew the dictation path, so
  // on builds where the voice note is the primary (recognizer absent) the Home
  // mic opened the screen and then did NOTHING — the top «не работает» report.
  // If neither input exists once probes resolve, say so instead of silence.
  useEffect(() => {
    if (!voice || consumedVoiceToken.current === voice) return;
    if (AI_CONFIGURED && recordingAvailable) {
      consumedVoiceToken.current = voice;
      // Voice-note recorder is primary. If it can't actually start (permission
      // denied, mic busy), fall back to on-device dictation rather than leaving the
      // user on a screen where the mic came on but nothing is recording.
      void (async () => {
        const started = await toggleRecording();
        if (!started && speechAvailable) void toggleListening();
      })();
      return;
    }
    if (speechAvailable) {
      consumedVoiceToken.current = voice;
      void toggleListening();
      return;
    }
    if (speechProbed) {
      consumedVoiceToken.current = voice;
      setVoiceError(t('food.voiceError.unavailable'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, recordingAvailable, speechAvailable, speechProbed]);

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
      // The «рацион» list is region-scoped, so load it once the region is known.
      const diet = await listFoodChoices(db, resolveRegion(settings.region));
      if (!active) return;
      setMyDiet(diet);
      setProteinTarget(settings.targetProteinG);
      setSex(settings.sex ?? '');
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

  /// «Из моего рациона»: add a food the user has eaten before to the current draft
  /// with a starting 100 g the user then adjusts (grams_source 'estimated' so the
  /// card shows the "our guess — set the weight" nudge). APPENDS, so a daily eater
  /// can assemble a plate from memory (курица + рис + …) and type each weight. The
  /// per-100g is the exact remembered composition; the entry name follows the
  /// picked foods when the text field is still empty.
  function onMemoryPick(food: RememberedFood) {
    const grams = 100;
    const item: NutritionItem = {
      name_ru: food.name,
      name_en: food.name,
      grams,
      grams_source: 'estimated',
      confidence: 1,
      per100: food.per100,
      scaled: scaleToGrams(food.per100, grams),
      approximate: true,
      matched_name: food.name,
      userChosen: true, // deliberate pick from the journal → keep it remembered
    };
    setSource('text');
    setParseIssue(null);
    setDraft((prev) => {
      const items = [...(prev?.items ?? []), item];
      return recomputeDraft(region, items);
    });
    // Give the entry a real name from the picked foods while the field is empty.
    setText((prev) =>
      prev.trim().length === 0
        ? food.name
        : `${prev}${prev.trim().endsWith(',') ? '' : ','} ${food.name}`,
    );
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
  /// when online was actually expected (AI configured + consented). ONE message
  /// per outcome: photo/voice can't be parsed offline at all, and an empty
  /// offline text parse explains itself — the generic «не удалось распознать»
  /// hint stays out of the way then (it used to stack contradictorily).
  function acceptDraft(parsed: MealDraft, consentNow: boolean, kind: 'text' | 'photo' | 'audio') {
    setFreshDraft(parsed);
    // Voice/photo parses arrive with an EMPTY input field: echo what was
    // understood («борщ, хлеб, сметана») as editable text — the recognition
    // becomes visible up top, and the saved diary entry gets a real name
    // instead of «Без названия». The functional updater never clobbers text
    // the user typed (text parses, or edits made while the parse ran).
    if (parsed.items.length > 0) {
      const understood = parsed.items.map((it) => it.name_ru).join(', ');
      setText((prev) => (prev.trim().length === 0 ? understood : prev));
    }
    const offline = AI_CONFIGURED && consentNow && parsed.flags.offline_fallback;
    setParseIssue(
      !offline
        ? null
        : kind !== 'text'
          ? 'offlineMedia'
          : parsed.items.length === 0
            ? 'offlineEmpty'
            : 'offline',
    );
  }

  async function runTextParse(consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    try {
      acceptDraft(await applyMemory(await getFoodParser(consentNow).parse(text, region)), consentNow, 'text');
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
      acceptDraft(await applyMemory(await getFoodParser(consentNow).parsePhoto(photo, region)), consentNow, 'photo');
    } catch {
      setParseIssue('failed');
    } finally {
      setParsing(false);
      // The downscaled JPEG in `prepare()` (photoProvider.ts) was only ever
      // needed to reach the backend — clean it up on every path (success,
      // failure, offline stub) so cache doesn't accumulate one file per photo.
      deleteTempFile(photo.uri);
    }
  }

  async function runAudioParse(audio: AudioInput, consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    try {
      acceptDraft(await applyMemory(await getFoodParser(consentNow).parseAudio(audio, region)), consentNow, 'audio');
    } catch {
      setParseIssue('failed');
    } finally {
      setParsing(false);
      // Same cleanup as the photo path, for the recorded m4a clip.
      deleteTempFile(audio.uri);
    }
  }

  /// Telegram-style voice note: tap to start recording, tap again to stop + send.
  /// On stop the clip goes to the AI parser (the model transcribes + identifies;
  /// numbers still come from the DB). The cross-border AI consent is the same
  /// one-time gate as text/photo.
  /// Returns whether a NEW recording was started (false when it stopped an
  /// existing one, was blocked, or failed to start) — the deep-link auto-start
  /// uses this to fall back to dictation if the recorder couldn't come up.
  async function toggleRecording(): Promise<boolean> {
    if (parsing || listening) return false;
    if (recording) {
      const rec = recRef.current;
      recRef.current = null;
      meterUnsubRef.current?.();
      meterUnsubRef.current = null;
      setRecording(false);
      setMeterLevels([]);
      const audio = rec ? await rec.stop() : null;
      if (audio) {
        // A whole-clip peak at digital silence = the mic delivered nothing
        // (system privacy mute / held by another app). Say so instead of
        // sending silence to the model and answering «не удалось распознать»
        // («разрешил доступ, но звук не ловился», device feedback 2026-07-12).
        if (rec != null && isSilentRecording(rec.peakLevel())) {
          deleteTempFile(audio.uri);
          setVoiceError(t('food.voiceError.silent'));
        } else {
          await onAudio(audio);
        }
      }
      return false;
    }
    setFreshDraft(null);
    setVoiceError(null);
    const started = await startRecording();
    if (started.error) {
      // A mic tap that silently does nothing reads as "сломано" — and denied
      // vs "granted but wouldn't start" are DIFFERENT problems: the old single
      // «нет доступа» message blamed permissions for a busy mic.
      setVoiceError(
        t(started.error === 'denied' ? 'food.voiceError.not-allowed' : 'food.voiceError.mic-failed'),
      );
      return false;
    }
    const rec = started.recording;
    // The clip replaces whatever was being described before — clear the input
    // (photo-echo or stale text) so the parse echoes THIS note's foods. Done
    // only once recording actually started; a denied mic loses nothing.
    setText('');
    setParseIssue(null);
    recRef.current = rec;
    setMeterLevels([]);
    // Live amplitude → rolling buffer for the waveform. No-op when the build has
    // no metering (Expo Go), so the bars just stay at their idle baseline.
    meterUnsubRef.current = rec.onMeter((level) => {
      setMeterLevels((prev) => pushLevel(prev, level, 24));
    });
    setSource('voice');
    setRecording(true);
    return true;
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

  // Photo (camera or an earlier shot from the gallery) → downscale + EXIF
  // strip → (consent) → backend vision → two-tier draft.
  async function onPhoto(src: PhotoSource) {
    if (parsing || listening) return;
    setPhotoError(null);
    const result = await capturePhoto(src);
    if (result.status === 'cancelled') return;
    if (result.status === 'failed') {
      setPhotoError(t('food.photoError'));
      return;
    }
    // A new shot is a NEW attempt: clear the previous parse AND the input —
    // the echoed text of photo №1 used to survive into photo №2's draft and
    // become its (wrong) name (device feedback 2026-07-12: «инпут не
    // чистится»). Cleared only after a photo actually arrived, so cancelling
    // the picker loses nothing.
    setFreshDraft(null);
    setText('');
    setMeal(null);
    setParseIssue(null);
    const photo = result.photo;
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
    setMeal(null);
  }

  // Effective meal-of-day: the user's tap wins; until they touch the chips the
  // preselect is honest intent — a typed «завтрак…» keyword first, else the clock.
  const mealChoice: MealType = meal ?? mealTypeForEntry(text, new Date());

  async function onSave() {
    if (!draft || !db) return;
    setSaving(true);
    try {
      await saveParsedEntry(db, { rawText: text, source, draft, meal: mealChoice });
      // Personal food journal (layer 2): remember this food → per-100g so the
      // same name resolves to it next time, on-device only. We remember:
      //   • anything the user explicitly chose/edited (userChosen), OR
      //   • a confident real-source auto-match (a solid DB/label hit).
      // We do NOT cement: DB-miss placeholders, RAW AI estimates (a guess must
      // not become "my truth" until the user touches it — editing flips it to
      // 'manual'), or shaky low-confidence matches (incl. referee-demoted ones
      // like the skyr→«яблоко» mismatch), which would otherwise stick.
      const REMEMBER_CONFIDENCE_FLOOR = 0.5;
      for (const it of draft.items) {
        const src = it.per100.source;
        const realSource = src !== 'estimate' && src !== 'ai_estimate';
        const trustworthy = it.userChosen || it.confidence >= REMEMBER_CONFIDENCE_FLOOR;
        if (realSource && trustworthy) {
          // Key by the RAW typed name (so the correction sticks to what the user
          // types next time); store the DISPLAY name (real DB row once re-picked).
          await rememberFoodChoice(db, region, lookupNameForItem(it, region), {
            name: displayItemName(it, region),
            per100: it.per100,
          });
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
          if (photoError) setPhotoError(null);
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
        // Camera and gallery side by side: a fresh shot of the plate, or a
        // photo taken earlier — both go through the same downscale/EXIF-strip.
        <View style={styles.photoRow}>
          {(
            [
              { src: 'camera', label: t('food.photo') },
              { src: 'library', label: t('food.photoLibrary') },
            ] as const
          ).map(({ src, label }) => (
            <Pressable
              key={src}
              onPress={() => void onPhoto(src)}
              disabled={parsing || listening || recording}
              style={({ pressed }) => [
                styles.micButton,
                styles.photoButton,
                { borderColor: theme.separator, backgroundColor: theme.card, opacity: pressed || parsing || listening || recording ? 0.6 : 1 },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.micText, { color: theme.primary }, theme.font.bodySemiBold]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {photoError ? (
        <Text style={[styles.voiceError, { color: theme.subtle }, theme.font.body]}>{photoError}</Text>
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
          {t(`food.parseIssue.${parseIssue}`)}
        </Text>
      ) : null}

      {/* «Из моего рациона» — per-food memory, always available (even mid-draft)
          so a daily eater can assemble a plate food-by-food and type each weight.
          Tapping appends the food; grams are set in its card below. */}
      {myDiet.length > 0 ? (
        <View style={styles.quick}>
          <View style={styles.quickGroup}>
            <Text style={[styles.quickLabel, { color: theme.subtle }, theme.font.heading]}>
              {t('food.myDiet').toUpperCase()}
            </Text>
            <Text style={[styles.myDietHint, { color: theme.subtle }, theme.font.body]}>
              {t('food.myDietHint')}
            </Text>
            <View style={styles.quickWrap}>
              {myDiet.slice(0, 12).map((food, i) => (
                <Pressable
                  key={i}
                  onPress={() => onMemoryPick(food)}
                  style={({ pressed }) => [
                    styles.chip,
                    { backgroundColor: theme.card, borderColor: theme.separator, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text numberOfLines={1} style={[styles.chipText, { color: theme.text }, theme.font.bodySemiBold]}>
                    {food.name}
                  </Text>
                  <Text style={[styles.chipMacro, { color: theme.subtle }, theme.font.body]}>
                    {hideCalories
                      ? `${t('macros.protein')} ${Math.round(food.per100.prot)} ${t('units.g')} / 100 ${t('units.g')}`
                      : `${Math.round(food.per100.kcal)} ${t('units.kcal')} / 100 ${t('units.g')}`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
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
        // The «опишите и нажмите Разобрать» invitation is for the IDLE state
        // only — while a parse/recording/dictation runs it read as a second,
        // contradictory instruction (device feedback 2026-07-12).
        parsing || recording || listening ? null : (
          <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.empty')}</Text>
        )
      ) : draft.items.length === 0 ? (
        // An offline outcome already explained the empty result above — a
        // second «не удалось распознать» under it read as gibberish.
        parseIssue == null ? (
          <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.needHelp')}</Text>
        ) : null
      ) : (
        <View style={styles.results}>
          {draft.items.map((item, i) => (
            <ItemCard
              key={i}
              item={item}
              hideCalories={hideCalories}
              theme={theme}
              onGrams={(g) => onItemGrams(i, g)}
              onManualMacros={(m) => onItemManualMacros(i, m)}
              onSelectAlternative={(altIndex) => onItemSelectAlternative(i, altIndex)}
              onSearch={onItemSearch}
              onReplace={(alt) => onItemReplace(i, alt)}
            />
          ))}

          {draft.items.every((it) => it.per100.source === 'estimate') ? (
            /* Every item is a DB miss → the total would be a fabricated row of
               zeros wearing an «≈» badge («зачем-то выдал болванки», device
               feedback 2026-07-12). One plain sentence instead; the real total
               card returns as soon as anything actually counts. */
            <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
              {t('food.totalAllMisses')}
            </Text>
          ) : (
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
            {/* Vitamins & minerals for the WHOLE dish, as % of the daily norm —
                the "сколько выходит за блюдо" the day-level panel can't answer. */}
            <MicroScales
              values={draft.totals}
              sex={sex}
              estimated={draft.items.some((it) => it.micros_estimated === true)}
              theme={theme}
            />
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
            {draft.flags.has_ai_estimate ? (
              <Text style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>{t('food.aiEstimateNote')}</Text>
            ) : null}
          </Card>
          )}

          {/* Which meal this entry files under — stored with the save so the
              day view groups by the user's word, not the clock's guess. */}
          <MealChips value={mealChoice} onChange={setMeal} />

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

/// Vitamins & minerals for a whole dish as a share of the daily norm — the same
/// honest FillBar the day view uses, scoped to what the user is logging now. A
/// bar appears ONLY for a micronutrient the dish actually carries (never an
/// implied zero); collapsed by default so it doesn't crowd the total card.
function MicroScales({
  values,
  sex,
  estimated,
  theme,
}: {
  values: NutrientValues;
  sex: '' | Sex;
  estimated: boolean;
  theme: Theme;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const measured = dailyMicroNorms(sex)
    .map((row) => ({ row, intake: microIntakeOf(values, row) }))
    .filter((x): x is { row: MicroRow; intake: number } => x.intake != null);
  if (measured.length === 0) return null;
  return (
    <View style={styles.altWrap}>
      <Pressable onPress={() => setOpen((s) => !s)} hitSlop={6}>
        <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
          {open ? t('food.microsDish.hide') : t('food.microsDish.show')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailBox}>
          {(['vitamin', 'mineral'] as const).map((group) => {
            const rows = measured.filter((x) => x.row.group === group);
            if (rows.length === 0) return null;
            return (
              <View key={group} style={styles.microGroup}>
                <Text style={[styles.microGroupHeading, { color: theme.subtle }, theme.font.bodySemiBold]}>
                  {t(`weight.micros.groups.${group}`)}
                </Text>
                {rows.map(({ row, intake }) => {
                  const pct = row.value > 0 ? Math.round((intake / row.value) * 100) : 0;
                  return (
                    <View key={row.key} style={styles.microRow}>
                      <View style={styles.microRowHead}>
                        <Text style={[styles.microName, { color: theme.text }, theme.font.body]}>
                          {t(`weight.micros.name.${row.key}`)}
                        </Text>
                        <Text style={[styles.microVal, { color: theme.subtle }, theme.font.body]}>
                          {fmtMicro(row, intake)} {t(`weight.micros.unit.${row.unit}`)} ·{' '}
                          {t('food.micros.ofNorm', { pct })}
                        </Text>
                      </View>
                      <FillBar value={intake} min={row.value} max={row.limit} thickness={8} />
                    </View>
                  );
                })}
              </View>
            );
          })}
          {sex !== 'male' && sex !== 'female' ? (
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>
              {t('food.microsDish.needSex')}
            </Text>
          ) : null}
          {estimated ? (
            <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>
              {t('food.microsDish.estimated')}
            </Text>
          ) : null}
          <Text style={[styles.microNote, { color: theme.subtle }, theme.font.body]}>{t('food.microsDish.note')}</Text>
        </View>
      ) : null}
    </View>
  );
}

/// The dish's amount of one norm row, or null when the dish carries none of it
/// (so the caller shows no bar rather than an implied zero). Mirrors the day
/// view's `microIntake`, reading a scaled NutrientValues block.
function microIntakeOf(values: NutrientValues, row: MicroRow): number | null {
  const src = (row.group === 'mineral' ? values.minerals : values.vitamins) as
    | Record<string, number | undefined>
    | undefined;
  const v = src?.[row.key];
  return typeof v === 'number' && v > 0 ? v : null;
}

/// Whole numbers for µg + minerals; sub-mg vitamins keep 1 dp (matches day view).
function fmtMicro(row: MicroRow, v: number): string {
  return row.group === 'vitamin' && row.unit === 'mg' ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString();
}

function ItemCard({
  item,
  hideCalories,
  theme,
  onGrams,
  onManualMacros,
  onSelectAlternative,
  onSearch,
  onReplace,
}: {
  item: NutritionItem;
  hideCalories: boolean;
  theme: Theme;
  onGrams: (grams: number) => void;
  onManualMacros: (macros: { kcal: number; prot: number; fat: number; carb: number }) => void;
  onSelectAlternative: (altIndex: number) => void;
  onSearch: (query: string) => Promise<NutritionAlternative[]>;
  onReplace: (replacement: NutritionAlternative) => void;
}) {
  const { t } = useTranslation();
  // TRANSPARENCY: which DB row the numbers describe. Shown when the matched
  // row's own name differs from what the user logged («картошка» → «картофель
  // варёный») — the row name usually carries the preparation state, so the
  // user can judge the baseline instead of guessing. To change the state the
  // user picks another match ("не то?"/"найти вручную") or re-parses a clearer
  // query — we no longer apply a coarse cooking-method multiplier ourselves.
  const matchedLabel =
    item.matched_name &&
    normalizeChoiceName(item.matched_name) !== normalizeChoiceName(item.name_ru) &&
    normalizeChoiceName(item.matched_name) !== normalizeChoiceName(item.name_en)
      ? item.matched_name
      : null;
  // The card title = what the user logged (or the DB name after an explicit
  // re-pick). The matched DB row, when it differs, is shown on the small grey
  // «на 100 г» line below — not crammed into the title in parens (which read as
  // «молоко 1.8% (молоко 3.2%)» → «почему 3.2%?»).
  const titleName = item.userChosen && item.matched_name ? item.matched_name : item.name_ru;
  // The "per 100 g · <source>" line shows the DB row itself (the footnote's promise).
  const dbPer100 = item.per100;
  // A full DB miss: the resolver's coarse placeholder. We show NO fabricated
  // numbers for it — only an honest "not in our database" + manual entry.
  const isMiss = item.per100.source === 'estimate';
  // Other DB matches the user can switch to. Low confidence in the auto-pick
  // opens the list proactively; otherwise it hides behind a "не то?" toggle.
  const alternatives = item.alternatives ?? [];
  // REFEREE signal: the server only injects an `ai_estimate` alternative when a
  // DB match grossly contradicted the model's expectation for this food (a
  // likely wrong-product match, e.g. «мясное рагу» → pure «Beef, stew meat»).
  // We warn and open the picker so the inflated numbers aren't taken at face value.
  const refereeFlagged = alternatives.some((a) => a.per100.source === 'ai_estimate');
  // ONE «Другой вариант» disclosure unifies the DB alternatives AND manual search
  // (they both answer «take a different product»). Opens itself when the auto-pick
  // is shaky (low confidence or a referee flag) so the choice isn't buried.
  const [otherOpen, setOtherOpen] = useState(item.confidence < 0.5 || refereeFlagged);
  const [searchText, setSearchText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<NutritionAlternative[] | null>(null);
  const grams = Math.round(item.grams);
  const PORTIONS = [100, 200, 250];

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

  // The eaten total is the HERO — it's what the user is logging. Per-100g and the
  // source drop to a small grey line; the DB match, alternatives and manual search
  // collapse under one «Другой вариант». Honesty (source, «≈», wrong-product note)
  // stays, only quieter.
  const sourceInLine =
    item.per100.source === 'ai_estimate' || item.per100.source === 'manual'
      ? '' // already shown as the header badge — no need to repeat
      : ` · ${t(`food.source.${item.per100.source}`)}`;
  const per100Line = hideCalories
    ? `${t('macros.protein')} ${dbPer100.prot} · ${t('macros.fat')} ${dbPer100.fat} · ${t('macros.carbs')} ${dbPer100.carb}`
    : `${dbPer100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${dbPer100.prot} · ${t('macros.fat')} ${dbPer100.fat} · ${t('macros.carbs')} ${dbPer100.carb}`;

  return (
    <Card style={styles.item}>
      {/* Header: what the user logged + one estimate/manual flag (DB source is
          quieter, on the grey line below). */}
      <View style={styles.itemHead}>
        <Text style={[styles.itemName, { color: theme.text }, theme.font.bodySemiBold]} numberOfLines={2}>
          {titleName}
        </Text>
        {item.per100.source === 'ai_estimate' || item.per100.source === 'manual' ? (
          <View style={[styles.badge, { borderColor: theme.primary }]}>
            <Text style={[styles.badgeText, { color: theme.primary }, theme.font.body]}>
              {t(`food.source.${item.per100.source}`)}
            </Text>
          </View>
        ) : null}
      </View>

      {isMiss ? (
        <Text style={[styles.notInDb, { color: theme.subtle }, theme.font.body]}>{t('food.notInDb')}</Text>
      ) : (
        <>
          {/* HERO — the eaten amount, big and first. */}
          <View style={styles.heroRow}>
            <Text style={[styles.heroValue, { color: theme.text }, theme.font.bodySemiBold]}>
              {hideCalories ? item.scaled.prot : item.scaled.kcal}
            </Text>
            <Text style={[styles.heroUnit, { color: theme.subtle }, theme.font.body]}>
              {hideCalories
                ? `${t('macros.protein').toLowerCase()} · ${t('food.forGrams', { grams })}`
                : `${t('units.kcal')} · ${t('food.forGrams', { grams })} · ${t('macros.protein')} ${item.scaled.prot} ${t('units.g')}`}
            </Text>
            {item.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
          </View>

          {/* Secondary grey line: the matched DB row + its per-100g + source. */}
          <Text style={[styles.per100Line, { color: theme.subtle }, theme.font.body]}>
            {matchedLabel ? `${matchedLabel} · ` : ''}
            {t('food.per100')} {per100Line}
            {sourceInLine}
          </Text>

          {/* Full micro breakdown, collapsed. */}
          <NutrientDetail values={item.scaled} caption={t('food.detail.basis', { grams })} theme={theme} />

          {/* HONESTY notes — only when they apply. */}
          {item.dry_basis ? (
            <View style={[styles.dryBasisNote, { borderColor: theme.primary, backgroundColor: theme.card }]}>
              <Text style={[styles.dryBasisText, { color: theme.text }, theme.font.body]}>{t('food.dryBasis')}</Text>
            </View>
          ) : null}
          {refereeFlagged ? (
            <View style={[styles.dryBasisNote, { borderColor: theme.primary, backgroundColor: theme.card }]}>
              <Text style={[styles.dryBasisText, { color: theme.text }, theme.font.body]}>
                {t('food.refereeMismatch')}
              </Text>
            </View>
          ) : null}
        </>
      )}

      {/* Manual per-100g entry — on a DB miss (enter real numbers) and over an AI
          estimate (correct the guess → source flips to honest 'manual'). */}
      {isMiss || item.per100.source === 'manual' || item.per100.source === 'ai_estimate' ? (
        <ManualMacros item={item} isMiss={isMiss} theme={theme} onManualMacros={onManualMacros} />
      ) : null}

      {/* WEIGHT — the main thing users adjust. Quick-set chips + a custom field;
          tapping either confirms the weight (the «прикидка» caption disappears). */}
      <View style={styles.portionRow}>
        {PORTIONS.map((p) => {
          const active = grams === p;
          return (
            <Pressable
              key={p}
              onPress={() => onGrams(p)}
              style={({ pressed }) => [
                styles.portionChip,
                {
                  borderColor: active ? theme.primary : theme.separator,
                  backgroundColor: theme.card,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[styles.portionChipText, { color: active ? theme.primary : theme.subtle }, theme.font.body]}
              >
                {p} {t('units.g')}
              </Text>
            </Pressable>
          );
        })}
        <TextField
          value={String(grams)}
          onChangeText={(v) => onGrams(toNumber(v))}
          keyboardType="numeric"
          style={styles.gramsInput}
        />
        <Text style={[styles.gramsUnit, { color: theme.subtle }, theme.font.body]}>{t('units.g')}</Text>
      </View>
      {item.grams_source === 'estimated' ? (
        <Text style={[styles.gramsEstimate, { color: theme.subtle }, theme.font.body]}>
          {t('food.gramsEstimatedShort')}
        </Text>
      ) : null}

      {/* ONE «Другой вариант» — DB alternatives (from the parse) AND manual search
          in the same disclosure. Opens itself on a shaky auto-pick. */}
      <View style={styles.altWrap}>
        <Pressable onPress={() => setOtherOpen((s) => !s)} hitSlop={6}>
          <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
            {otherOpen
              ? t('food.otherOption.hide')
              : alternatives.length > 0
                ? t('food.otherOption.openCount', { count: alternatives.length })
                : t('food.otherOption.open')}
          </Text>
        </Pressable>
        {otherOpen ? (
          <View style={styles.altList}>
            {alternatives.map((alt, j) => (
              <Pressable
                key={`a-${alt.name}-${j}`}
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
                    ? `${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`
                    : `${alt.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`}
                </Text>
              </Pressable>
            ))}
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
                  setOtherOpen(false);
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
                    ? `${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`
                    : `${alt.per100.kcal} ${t('units.kcal')} · ${t('macros.protein')} ${alt.per100.prot} · ${t(`food.source.${alt.per100.source}`)}`}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
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
              // An em-dash, not «0»: four zeros in a row read as pre-filled
              // data («болванки»), while a dash reads as awaiting input.
              placeholder="—"
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
  photoRow: { flexDirection: 'row', gap: 8 },
  photoButton: { flex: 1, paddingHorizontal: 12 },
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
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  itemName: { fontSize: 15, flex: 1 },
  // HERO: the eaten amount — big number + small unit, first thing in the card.
  heroRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 2 },
  heroValue: { fontSize: 26 },
  heroUnit: { fontSize: 13, flexShrink: 1 },
  // Quiet secondary: matched DB row + per-100g + source.
  per100Line: { fontSize: 12, marginBottom: 2, lineHeight: 17 },
  // Quick-set weight chips.
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  portionChip: { borderWidth: 1, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  portionChipText: { fontSize: 13 },
  detailBox: { marginTop: 6, gap: 3 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: 12 },
  detailValue: { fontSize: 12 },
  detailCaption: { fontSize: 10, fontStyle: 'italic', marginTop: 4, lineHeight: 14 },
  dryBasisNote: { marginTop: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  dryBasisText: { fontSize: 12, lineHeight: 17 },
  microGroup: { marginTop: 8, gap: 6 },
  microGroupHeading: { fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },
  microRow: { gap: 3 },
  microRowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  microName: { fontSize: 12 },
  microVal: { fontSize: 11 },
  microNote: { fontSize: 10, fontStyle: 'italic', marginTop: 6, lineHeight: 14 },
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
  gramsEstimate: { fontSize: 10, fontStyle: 'italic', marginTop: 2, lineHeight: 14 },
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
  myDietHint: { fontSize: 12, marginTop: -2, marginBottom: 8, lineHeight: 16 },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 14, maxWidth: 240 },
  chipMacro: { fontSize: 11, marginTop: 2 },
});
