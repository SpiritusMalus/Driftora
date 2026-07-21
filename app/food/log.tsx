import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { ItemCard } from '@/components/food/ItemCard';
import { MealChips } from '@/components/food/MealChips';
import { ApproxBadge, MicroScales, NutrientDetail } from '@/components/food/nutrientViews';
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
} from '@/lib/core/services/foodChoice';
import { getAiQuotaRemaining } from '@/lib/core/services/aiQuota';
import {
  adoptOnUnmount,
  clearInFlight,
  isAdopted,
  registerInFlight,
} from '@/lib/core/services/backgroundParses';
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
import type { AudioInput, MealDraft, NutritionAlternative, NutritionItem, PhotoInput, Region } from '@/lib/core/services/foodParser';
import type { Sex } from '@/lib/core/insights/bodyMetrics';
import { getFoodParser, resolveRegion } from '@/lib/core/services/foodParserProvider';
import { recomputeDraft, scaleToGrams, withItemAlternative, withItemGrams, withItemManualMacros, withItemReplacement } from '@/lib/core/services/mealDraft';
import { capturePhoto, isPhotoCaptureAvailable, type PhotoSource } from '@/lib/core/services/photoProvider';
import { getSpeechService } from '@/lib/core/services/speechProvider';
import { useTheme } from '@/lib/theme/theme';

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
  // can't be parsed offline at all; 'quota' = today's per-install AI budget is
  // spent (manual/chip paths remain); 'failed' = the parse itself threw locally.
  const [parseIssue, setParseIssue] = useState<
    'offline' | 'offlineEmpty' | 'offlineMedia' | 'serverBusy' | 'quota' | 'failed' | null
  >(null);
  // Server-reported remaining daily AI budget (X-AI-Quota-Remaining) — drives
  // the quiet «осталось N» line once it runs low. Null = never reported.
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [savedAck, setSavedAck] = useState<string | null>(null);
  // The DB write itself threw. Without a visible line the tap looks ignored and
  // the user walks away sure the meal was logged.
  const [saveIssue, setSaveIssue] = useState(false);
  const saveSeedRef = useRef(0);
  // Post-save exit timer — must be cleared on unmount, or a back within the
  // ack window later yanks the user off whatever screen they moved to.
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // A multi-photo batch (library multi-select): the photos still awaiting their
  // OWN parse+save after the one under review. Each becomes a SEPARATE entry
  // (device feedback 2026-07-15: «сфоткал отдельно все блюда»). Empty = the
  // ordinary single-photo/voice/text flow. `batchTotal` is the picked count, so
  // the review can show «фото N из M».
  const [photoQueue, setPhotoQueue] = useState<PhotoInput[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  // Mirror for the unmount sweep — the cleanup closure would otherwise hold the
  // mount-time (empty) queue and leak the downscaled JPEGs still waiting in it.
  const photoQueueRef = useRef<PhotoInput[]>([]);
  photoQueueRef.current = photoQueue;
  // Same live-mirror idiom for the background hand-off (adoptOnUnmount): the
  // unmount cleanup runs once, where state would be frozen at mount time.
  const mealRef = useRef<MealType | null>(null);
  mealRef.current = meal;
  const consentRef = useRef(false);
  consentRef.current = aiConsent;
  const regionRef = useRef<Region>(region);
  regionRef.current = region;
  const dbRef = useRef(db);
  dbRef.current = db;
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
  // Which capture method the segmented control shows. The text field stays
  // visible in every mode — it's the shared surface where voice/photo echo what
  // they understood — so this only swaps the secondary control row (mic/photo).
  const [inputMode, setInputMode] = useState<'text' | 'voice' | 'photo'>('text');
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
      if (exitTimerRef.current != null) clearTimeout(exitTimerRef.current);
      // Leaving mid-parse or mid-batch: hand the work to the background service
      // FIRST — the in-flight request and queued shots become «разбирается…»
      // entries that finish on their own (hybrid confirm: unconfirmed until
      // opened). Only the consented online path adopts — the offline stub
      // can't parse a photo, so adopting it would just mint failed rows.
      if (dbRef.current && consentRef.current && AI_CONFIGURED) {
        adoptOnUnmount(dbRef.current, {
          queued: photoQueueRef.current,
          region: regionRef.current,
          meal: mealRef.current,
          consent: consentRef.current,
        });
      }
      // Batch leftovers that never reached their parse are downscaled JPEGs in
      // cache — sweep whatever the service did NOT adopt (offline/consent-less
      // exits) so an abandoned batch doesn't accumulate files. Adoption marks
      // its uris synchronously, so this order is race-free.
      for (const p of photoQueueRef.current) if (!isAdopted(p.uri)) deleteTempFile(p.uri);
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
    // Deep-link (?voice=1) starts dictation without a segment tap — reveal the
    // voice controls so the mic isn't live behind a hidden segment.
    setInputMode('voice');
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
        : // Today's per-install AI budget is spent (429) — «нет интернета» would
          // be a lie the user can see through; the remedy is the manual/chip
          // paths until the daily reset, not hunting for signal.
          parsed.flags.quota_exceeded
          ? 'quota'
          : // The server answered, it just couldn't parse — blaming the connection
            // sends the user to check a wifi that is plainly working.
            parsed.flags.server_error
            ? 'serverBusy'
            : kind !== 'text'
              ? 'offlineMedia'
              : parsed.items.length === 0
                ? 'offlineEmpty'
                : 'offline',
    );
    setQuotaLeft(getAiQuotaRemaining());
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
    // The promise is captured BEFORE the await so that leaving the screen
    // mid-parse can hand this exact in-flight request to the background
    // service — adoption must not re-bill a parse that is seconds from landing.
    const parseP = getFoodParser(consentNow).parsePhoto(photo, region);
    registerInFlight({ promise: parseP, photo });
    try {
      const parsed = await parseP;
      // Screen died mid-parse and the service took over: it writes the entry
      // itself — this (possibly unmounted) closure stands down.
      if (isAdopted(photo.uri)) return;
      acceptDraft(await applyMemory(parsed), consentNow, 'photo');
    } catch {
      if (!isAdopted(photo.uri)) setParseIssue('failed');
    } finally {
      clearInFlight(photo.uri);
      setParsing(false);
      // The downscaled JPEG in `prepare()` (photoProvider.ts) was only ever
      // needed to reach the backend — clean it up on every path (success,
      // failure, offline stub) so cache doesn't accumulate one file per photo.
      // An ADOPTED photo is the exception: the service still needs the file
      // for its retry affordance and cleans up after itself.
      if (!isAdopted(photo.uri)) deleteTempFile(photo.uri);
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
    // Same as dictation: a ?voice=1 deep-link records without a segment tap, so
    // surface the voice controls (waveform + stop button).
    setInputMode('voice');
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
  // Begin ONE photo's parse. A fresh shot is a NEW attempt: clear the previous
  // parse AND the input — the echoed text of photo №1 used to survive into photo
  // №2's draft and become its (wrong) name (device feedback 2026-07-12: «инпут
  // не чистится»). Shared by the first pick and every batch advance, so a queued
  // photo resets the same way. Consent-gates before the first photo→AI send.
  function startPhoto(photo: PhotoInput) {
    setFreshDraft(null);
    setText('');
    setMeal(null);
    setParseIssue(null);
    setSavedAck(null);
    setSource('photo');
    if (AI_CONFIGURED && needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })) {
      // Stronger, SEPARATE photo warning before the first photo→AI send (§C).
      // Asked once per batch — once granted, later queued photos skip straight
      // to the parse.
      setPendingPhoto(photo);
      setConsentPrompt('photo');
      return;
    }
    void runPhotoParse(photo, aiConsent);
  }

  async function onPhoto(src: PhotoSource) {
    if (parsing || listening) return;
    setPhotoError(null);
    // Gallery allows picking several dishes at once; the camera stays single.
    const result = await capturePhoto(src, { multiple: src === 'library' });
    if (result.status === 'cancelled') return;
    if (result.status === 'failed') {
      setPhotoError(t('food.photoError'));
      return;
    }
    // Library multi-select → each dish its own entry: parse the first now, queue
    // the rest; every save advances to the next (see onSave). Cleared only after
    // photos actually arrived, so cancelling the picker loses nothing.
    const [first, ...rest] = result.photos;
    setPhotoQueue(rest);
    setBatchTotal(result.photos.length);
    startPhoto(first);
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
  // picks a result. The query text goes to the same online parser, so it is
  // gated like a parse: consent must exist AT THE CURRENT disclosure version —
  // after a sub-processor change a stale consent falls back to the stub.
  function onItemSearch(query: string): Promise<NutritionAlternative[]> {
    const consentCurrent =
      aiConsent &&
      !needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion });
    return getFoodParser(consentCurrent).searchFoods(query, region);
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
    setSaveIssue(false);
    setSource('text');
    setParseIssue(null);
    setMeal(null);
    // Abandon any remaining batch — «очистить» means the whole capture is off.
    // The queued shots never reach their parse's own cleanup, so sweep here.
    for (const p of photoQueue) deleteTempFile(p.uri);
    setPhotoQueue([]);
    setBatchTotal(0);
  }

  // Effective meal-of-day: the user's tap wins; until they touch the chips the
  // preselect is honest intent — a typed «завтрак…» keyword first, else the clock.
  const mealChoice: MealType = meal ?? mealTypeForEntry(text, new Date());

  // Voice is offered when EITHER the AI voice-note recorder or on-device
  // dictation is available; the segment only lists methods the device actually
  // has, so it collapses to nothing when text is the only path.
  const voiceMode = (AI_CONFIGURED && recordingAvailable) || speechAvailable;
  /// Drop one dish from the parse draft — the «добавил лишнее, а удалить
  /// нельзя» gap (device feedback 2026-07-20). Removing the last item closes
  /// the draft entirely: an empty result must not pretend to be a meal.
  function onItemRemove(index: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((_, i) => i !== index);
      return items.length > 0 ? recomputeDraft(prev.region, items) : null;
    });
  }

  const visibleModes = (['text', 'voice', 'photo'] as const).filter(
    (m) => m === 'text' || (m === 'voice' ? voiceMode : photoAvailable),
  );

  // One «Быстро» lane instead of three stacked headers («Как вчера»/«Избранное»/
  // «Недавнее» read as four near-identical uppercase sections). Priority
  // yesterday → favorites → recents, deduped by the meal text so a meal eaten
  // yesterday AND recently shows once.
  const quickPickList = (() => {
    const seen = new Set<string>();
    return [...quick.yesterday, ...quick.favorites, ...quick.recents]
      .filter((m) => {
        const key = m.rawText.trim().toLowerCase();
        if (key.length === 0 || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  })();

  async function onSave() {
    if (!draft || !db) return;
    setSaving(true);
    setSaveIssue(false);
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
      // Mid-batch (multi-photo): don't leave the screen — advance to the next
      // shot's parse so every photo becomes its own entry in one sitting. Only
      // the last one navigates out.
      if (photoQueue.length > 0) {
        const [next, ...rest] = photoQueue;
        setPhotoQueue(rest);
        setSaving(false);
        startPhoto(next);
        return;
      }
      setBatchTotal(0);
      // Land on the day's food list (not a bare back to Home) so the just-saved
      // entry is visibly there and can be reopened/edited. `replace` keeps the
      // log screen out of the back stack.
      exitTimerRef.current = setTimeout(() => router.replace('/food'), 1100);
    } catch {
      // Never fail into silence: the write threw, so say so — otherwise the
      // user leaves sure the meal was logged.
      setSaving(false);
      setSaveIssue(true);
    }
  }

  // Drop the current photo's draft WITHOUT saving and advance to the next in the
  // batch — a misfired shot (blurry, wrong dish) shouldn't force a junk entry.
  function onSkipPhoto() {
    if (photoQueue.length === 0) return;
    const [next, ...rest] = photoQueue;
    setPhotoQueue(rest);
    startPhoto(next);
  }

  // «Из моего рациона» — per-food memory so a daily eater can assemble a plate
  // food-by-food and type each weight. Tapping appends the food; grams are set
  // in its card. Rendered in ONE of two spots depending on the draft (idle:
  // under the parse button; mid-draft: below the results) — never above the
  // just-parsed cards.
  const myDietSection =
    myDiet.length > 0 ? (
      <View style={styles.quick}>
        <View style={styles.quickGroup}>
          <Text style={[styles.quickLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
            {t('food.myDiet').toUpperCase()}
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
    ) : null;

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
      {/* Capture method. The text field above stays in EVERY mode (it's also
          where voice/photo echo what they understood), so the segment only swaps
          the secondary control row — never the input itself. A mode's segment
          appears only once its probe confirms the device offers it; when text is
          the only path the whole row collapses (device feedback 2026-07-12: the
          three stacked controls overflowed the screen). Mirrors the workout
          screen's [Точно][С трекера][Описать]. */}
      {visibleModes.length > 1 ? (
        <View style={styles.segments}>
          {visibleModes.map((key) => {
            const active = inputMode === key;
            return (
              <Pressable
                key={key}
                onPress={() => setInputMode(key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.segment,
                  {
                    // Inactive segments sit on `iconBg`, a step off the card, so
                    // they don't melt into it on the dark «ember» theme.
                    backgroundColor: active ? theme.primary : theme.iconBg,
                    borderColor: active ? theme.primary : theme.separator,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.segmentText, { color: active ? theme.onPrimary : theme.text }, theme.font.body]}>
                  {t(`food.inputMode.${key}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* VOICE: the AI voice-note (record → send the clip → draft) is primary
          when an online parser is built in; otherwise the on-device STT mic
          fills the text field. */}
      {inputMode === 'voice' && voiceMode ? (
        AI_CONFIGURED && recordingAvailable ? (
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
        ) : (
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
        )
      ) : null}
      {/* Show voice errors in voice mode — and also when voice is unavailable
          entirely (no segment exists then), so the Home-mic ?voice=1 deep-link's
          «голос недоступен» message isn't swallowed. */}
      {voiceError && !listening && (inputMode === 'voice' || !voiceMode) ? (
        <Text style={[styles.voiceError, { color: theme.subtle }, theme.font.body]}>{voiceError}</Text>
      ) : null}

      {/* PHOTO: a fresh shot of the plate, or one taken earlier — both go
          through the same downscale/EXIF-strip. */}
      {inputMode === 'photo' && photoAvailable ? (
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
      {inputMode === 'photo' && photoError ? (
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
      ) : quotaLeft !== null && quotaLeft <= 3 ? (
        /* Honest heads-up instead of a surprise «лимит» at the day's fifth
           meal — rendered only once the server-reported budget runs low. */
        <Text style={[styles.parseIssue, { color: theme.subtle }, theme.font.body]}>
          {t('food.quotaLeft', { n: quotaLeft })}
        </Text>
      ) : null}

      {/* «Из моего рациона» — while IDLE it sits right under the parse button
          as a starting point. Once a draft exists it renders BELOW the results
          instead (see after the results block): a wall of diet chips above the
          cards buried what was just parsed off-screen, reading as «ничего не
          нашлось» (device feedback 2026-07-16). */}
      {draft == null ? myDietSection : null}

      {draft == null && quickPickList.length > 0 ? (
        <View style={styles.quick}>
          <View style={styles.quickGroup}>
            <Text style={[styles.quickLabel, { color: theme.labelCaps }, theme.font.bodyBold]}>
              {t('food.quickPick').toUpperCase()}
            </Text>
            <View style={styles.quickWrap}>
              {quickPickList.map((m, i) => (
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
        </View>
      ) : null}

      {/* Multi-photo batch progress: where in the picked set this review sits,
          plus a skip for a misfired shot. Shown for a parsed draft, an empty
          parse AND a failed parse (draft == null but parseIssue set) — a broken
          shot must not strand the rest of the batch out of reach. */}
      {batchTotal > 1 && (draft != null || parseIssue != null) ? (
        <View style={styles.batchBar}>
          <Text style={[styles.batchProgress, { color: theme.subtle }, theme.font.bodySemiBold]}>
            {t('food.batchProgress', { index: batchTotal - photoQueue.length, total: batchTotal })}
          </Text>
          {photoQueue.length > 0 ? (
            <Pressable onPress={onSkipPhoto} disabled={saving} hitSlop={8}>
              <Text style={[styles.batchSkip, { color: theme.primary }, theme.font.bodySemiBold]}>
                {t('food.batchSkip')}
              </Text>
            </Pressable>
          ) : null}
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
              onRemove={() => onItemRemove(i)}
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
            <Text style={[styles.totalLabel, { color: theme.subtle }, theme.font.body]}>{t('food.total')}</Text>
            {/* HERO — the meal's total is what lands in the diary, so it leads big
                like each item's eaten amount (it used to be a 14px line, quieter
                than the per-item heroes it sums). */}
            <View style={styles.totalHeroRow}>
              <Text style={[styles.totalValue, { color: theme.text }, theme.font.bodySemiBold]}>
                {hideCalories ? draft.totals.prot : draft.totals.kcal}
              </Text>
              <Text style={[styles.totalUnit, { color: theme.subtle }, theme.font.body]}>
                {hideCalories
                  ? `${t('macros.protein').toLowerCase()} ${t('units.g')}`
                  : `${t('units.kcal')} · ${t('macros.protein')} ${draft.totals.prot} ${t('units.g')} · ${t('macros.fat')} ${draft.totals.fat} · ${t('macros.carbs')} ${draft.totals.carb}`}
              </Text>
              {draft.approximate ? <ApproxBadge theme={theme} label={t('food.approx')} /> : null}
            </View>
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
            {/* The approximation caveats (≈ badge already says «примерно» up top)
                collapse under one «Почему приблизительно» — honest, present, but
                no longer three grey paragraphs stacked under the total. */}
            <ApproxNotes
              approximate={draft.approximate}
              hasEstimate={!!draft.flags.has_estimate}
              hasAiEstimate={!!draft.flags.has_ai_estimate}
            />
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
          {saveIssue ? (
            <Text style={[styles.parseIssue, { color: theme.primary }, theme.font.bodyMedium]}>
              {t('food.saveFailed')}
            </Text>
          ) : null}
          <Pressable onPress={onClearDraft} disabled={saving} hitSlop={8} style={styles.clearBtn}>
            <Text style={[styles.clearText, { color: theme.subtle }, theme.font.body]}>{t('food.clear')}</Text>
          </Pressable>
          {db == null ? (
            <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>{t('food.dbUnavailable')}</Text>
          ) : null}
        </View>
      )}

      {/* Mid-draft the diet chips stay reachable — below the results, so
          appending another food is one scroll away but never buries the cards. */}
      {draft != null ? myDietSection : null}

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

/// The meal total's approximation caveats, collapsed under one tap. Honesty is
/// preserved (the same three sentences, verbatim from i18n) but no longer three
/// grey paragraphs stacked under the number — the «≈ примерно» badge on the hero
/// already flags the total as an estimate; this explains why for whoever asks.
function ApproxNotes({
  approximate,
  hasEstimate,
  hasAiEstimate,
}: {
  approximate: boolean;
  hasEstimate: boolean;
  hasAiEstimate: boolean;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const notes = [
    approximate ? t('food.disclaimer') : null,
    hasEstimate ? t('food.estimateNote') : null,
    hasAiEstimate ? t('food.aiEstimateNote') : null,
  ].filter((n): n is string => n != null);
  if (notes.length === 0) return null;
  return (
    <View style={styles.altWrap}>
      <Pressable onPress={() => setOpen((s) => !s)} hitSlop={6}>
        <Text style={[styles.altToggle, { color: theme.primary }, theme.font.body]}>
          {open ? t('food.whyApprox.hide') : t('food.whyApprox.show')}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailBox}>
          {notes.map((n, i) => (
            <Text key={i} style={[styles.disclaimer, { color: theme.subtle }, theme.font.body]}>
              {n}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { marginBottom: 12 },
  // Capture-method segmented control (mirrors the workout screen). One method
  // visible at a time; inactive segments on `iconBg` so they read on dark.
  segments: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
  segmentText: { fontSize: 13 },
  micButton: { borderRadius: 999, borderWidth: 1.5, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  photoRow: { flexDirection: 'row', gap: 8 },
  photoButton: { flex: 1, paddingHorizontal: 12 },
  micText: { fontSize: 15 },
  voiceError: { fontSize: 13, textAlign: 'center', marginTop: -2, marginBottom: 8, lineHeight: 18 },
  // Shared by ApproxNotes (collapsed «Почему приблизительно»).
  altWrap: { marginTop: 8 },
  altToggle: { fontSize: 13 },
  detailBox: { marginTop: 6, gap: 3 },
  processingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 },
  clearBtn: { alignSelf: 'center', marginTop: 12, paddingVertical: 4 },
  clearText: { fontSize: 13, textDecorationLine: 'underline' },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 20 },
  results: { marginTop: 16 },
  totalCard: { marginTop: 4, marginBottom: 8 },
  totalLabel: { fontSize: 12, marginBottom: 2 },
  // HERO: the meal total leads big, like each item's eaten amount.
  totalHeroRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  totalValue: { fontSize: 26 },
  totalUnit: { fontSize: 13, flexShrink: 1 },
  hideCaloriesToggle: { marginTop: 8, alignSelf: 'flex-start' },
  hideCaloriesText: { fontSize: 12, textDecorationLine: 'underline' },
  disclaimer: { fontSize: 11, marginTop: 8, lineHeight: 16 },
  proteinNote: { fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  parseIssue: { fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 18 },
  savedAck: { fontSize: 13, marginTop: 4, marginBottom: 10, textAlign: 'center', lineHeight: 18 },
  batchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 14,
    marginBottom: 2,
  },
  batchProgress: { fontSize: 13 },
  batchSkip: { fontSize: 13 },
  quick: { marginTop: 16 },
  quickGroup: { marginBottom: 14 },
  quickLabel: { fontSize: 12, letterSpacing: 1.44, marginBottom: 8 },
  quickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 14, maxWidth: 240 },
  chipMacro: { fontSize: 11, marginTop: 2 },
});
