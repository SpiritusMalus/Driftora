import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { ConsentModal } from '@/components/consent/ConsentModal';
import { ItemCard } from '@/components/food/ItemCard';
import { MealChips } from '@/components/food/MealChips';
import { DAY_NAV_BACK_DAYS, DayNav } from '@/components/ui/DayNav';
import { ApproxBadge, MicroScales, NutrientDetail } from '@/components/food/nutrientViews';
import { Card } from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/PrimaryButton';
import { Screen } from '@/components/ui/Screen';
import { BarcodeScanner, type BarcodeOutcome } from '@/components/food/BarcodeScanner';
import { WaitOverlay } from '@/components/ui/wait/WaitOverlay';
import { TextField } from '@/components/ui/TextField';
import { Waveform } from '@/components/ui/Waveform';
import { pushLevel } from '@/components/ui/waveformBuffer';
import { AI_CONSENT_VERSION, grantAiConsent, needsAiConsent } from '@/lib/core/consent/consent';
import { useDatabase } from '@/lib/core/db/DatabaseProvider';
import {
  distinctFoodItemsToday,
  orderByMeal,
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
import { communityBaseAvailable, searchSourcesDown } from '@/lib/core/services/communityBase';
import { contributableFoods } from '@/lib/core/services/communityShare';
import { getAiQuotaRemaining, getAiQuotaScope, type AiQuotaScope } from '@/lib/core/services/aiQuota';
import {
  adoptOnUnmount,
  clearInFlight,
  isAdopted,
  registerInFlight,
} from '@/lib/core/services/backgroundParses';
import { deleteTempFile } from '@/lib/core/services/tempFiles';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';

import { daysAgo, formatDayTitle, localDayKey, parseDayKey, tsOnDay } from '@/lib/i18n/formatDay';
import { mealTitle } from '@/lib/core/insights/mealTitle';
import { mealTypeForEntry, promptKeyForMeal, type MealType } from '@/lib/core/insights/mealType';
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
import { itemFromQuickMeal, recomputeDraft, scaleToGrams, withItemAlternative, withItemGrams, withItemManualMacros, withItemReplacement } from '@/lib/core/services/mealDraft';
import { mergeReparsedDraft } from '@/lib/core/services/reparseMerge';
import { capturePhoto, isPhotoCaptureAvailable, type PhotoSource } from '@/lib/core/services/photoProvider';
import { getSpeechService } from '@/lib/core/services/speechProvider';
import { useTheme } from '@/lib/theme/theme';

/// Whether an online AI parser is even configured for this build. Consent and
/// the on-screen AI notice only matter when it is — otherwise everything is
/// offline and nothing can leave the device.
const AI_CONFIGURED = !!process.env.EXPO_PUBLIC_FOOD_API_URL;

/// When the quiet «осталось N» line appears, per budget shape.
///
/// The two numbers differ because the two budgets end differently. A paid day
/// refills at midnight, so a warning is a heads-up for the evening — three is
/// enough. The free trial ends for good, so the warning is the last chance to
/// decide whether to subscribe; at three left a person is already at the wall,
/// and finding out then reads as a trap. Ten is roughly two days' notice.
const DAY_QUOTA_WARN_AT = 3;
const FREE_QUOTA_WARN_AT = 10;


/// Text/voice → parse → two-tier honest result (exact per-100g + approximate
/// whole-dish total) → confirm grams → save.
export default function FoodLogScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const db = useDatabase();
  // The Home mic FAB deep-links here with ?voice=1 to start dictation at once;
  // the day list passes ?day=YYYY-MM-DD when its DayNav is on a past day, so
  // «добавить в тот день» opens this screen already aimed at it.
  const { voice, day: dayParam } = useLocalSearchParams<{ voice?: string; day?: string }>();
  // Region setting ('auto' until settings load); the active region honors it,
  // falling back to device locale (resolveRegion).
  const [regionSetting, setRegionSetting] = useState<'auto' | 'RU' | 'US'>('auto');
  const region: Region = resolveRegion(regionSetting);

  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<MealDraft | null>(null);
  // Latest committed draft for async consumers: a text parse can run up to
  // ~25 s, and merging against the `draft` captured at tap time would revert
  // every gram edit / removal / alternative pick made while it was in flight.
  const draftRef = useRef<MealDraft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  // Bumped on every dish removal: ItemCard holds internal state (manual macro
  // strings, an open search panel) and the list is keyed by index, so without
  // a remount the removed dish's state would bleed into its successor.
  const [itemsGen, setItemsGen] = useState(0);
  // The user renamed the meal by hand — stop deriving the name from the dishes
  // until the next parse consumes the field as input again.
  const [titleTouched, setTitleTouched] = useState(false);
  // Meal-of-day chips: the clock (or a typed «завтрак…») preselects, the user's
  // tap decides — their pick is stored with the entry so a late breakfast never
  // gets filed under «Обед» by the clock (device feedback 2026-07-10).
  const [meal, setMeal] = useState<MealType | null>(null);
  // Which day the entry is being written to. «Вчера забыл записать ужин» had no
  // direct answer here: every save stamped `new Date()`, so a meal could only
  // land on today (the workaround was save-then-re-file in the edit screen).
  // Same day-key currency and the same DayNav as the workout card. A valid
  // past-day ?day= param becomes the starting selection (a future or malformed
  // key falls back to today — a deep link must not aim a save at tomorrow).
  const [day, setDay] = useState(() => {
    const today = localDayKey(new Date());
    return typeof dayParam === 'string' && parseDayKey(dayParam) != null && dayParam < today
      ? dayParam
      : today;
  });
  // The DayNav floor never clips the day this screen was opened on: a param
  // older than the default horizon must stay reachable after a stray «›» tap.
  const [dayFloorExtra] = useState(() => daysAgo(day));
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
  // can't be parsed offline at all; 'quota' = today's paid AI budget is spent
  // and returns tomorrow; 'quotaFree' = the free trial is spent and does NOT
  // return (manual/chip paths remain either way); 'failed' = the parse itself
  // threw locally.
  const [parseIssue, setParseIssue] = useState<
    | 'offline'
    | 'offlineEmpty'
    | 'offlineMedia'
    | 'serverBusy'
    | 'quota'
    | 'quotaFree'
    | 'misconfigured'
    | 'failed'
    | null
  >(null);
  // Server-reported remaining AI budget (X-AI-Quota-Remaining / -Scope) — drives
  // the quiet «осталось N» line once it runs low. Null = never reported.
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [quotaScope, setQuotaScope] = useState<AiQuotaScope | null>(null);
  const [savedAck, setSavedAck] = useState<string | null>(null);
  // The DB write itself threw. Without a visible line the tap looks ignored and
  // the user walks away sure the meal was logged.
  const [saveIssue, setSaveIssue] = useState(false);
  const saveSeedRef = useRef(0);
  // Post-save exit timer — must be cleared on unmount, or a back within the
  // ack window later yanks the user off whatever screen they moved to.
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hideCalories, setHideCalories] = useState(false);
  // Opt-in sharing to the SHARED food base (settings, default off). Read here so
  // the post-save donation never has to hit the database on the way out.
  const [communityShare, setCommunityShare] = useState(false);
  // «Общая база»: the by-name way IN to the dishes other people entered — open
  // state, the query, and the last result set. Sits beside «Из моего рациона»:
  // one is the food you have eaten before, the other is the food someone else
  // has. Both append to the draft and both need a weight typed after.
  const [baseOpen, setBaseOpen] = useState(false);
  const [baseQuery, setBaseQuery] = useState('');
  const [baseSearching, setBaseSearching] = useState(false);
  const [baseResults, setBaseResults] = useState<NutritionAlternative[] | null>(null);
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
  // Lookahead-1 pipeline for the batch: while the user reviews the current
  // shot, the NEXT queued one is already parsing. The server still never sees
  // two concurrent requests — the overlap is with human review time, not with
  // another parse. Kills the «подтвердил еду и жду прогрузки» wait between
  // batch photos (owner feedback 2026-08-18).
  const prefetchRef = useRef<{ uri: string; promise: Promise<MealDraft> } | null>(null);
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
  // The shot/clip parked behind an unanswered consent modal — the unmount
  // cleanup must sweep their temp files (they are neither adopted nor queued).
  const pendingPhotoRef = useRef<PhotoInput | null>(null);
  pendingPhotoRef.current = pendingPhoto;
  const pendingAudioRef = useRef<AudioInput | null>(null);
  pendingAudioRef.current = pendingAudio;
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
  const [inputMode, setInputMode] = useState<'text' | 'voice' | 'photo' | 'barcode'>('text');
  /// Идёт поиск по считанному коду. Отдельно от `parsing`: модель не зовётся,
  /// экран не затемняется — ожидание тут миллисекундное, а камера должна
  /// оставаться видимой, чтобы человек не убирал телефон от упаковки.
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  /// Итог последнего кода. Пока он на экране, превью гаснет и внимание уходит
  /// на ответ — целиться уже не нужно.
  const [barcodeOutcome, setBarcodeOutcome] = useState<BarcodeOutcome | null>(null);
  // The `?voice=<token>` value we've already acted on. A fresh token (each Home
  // mic tap sends a unique one) re-triggers voice; probes resolving mid-flight
  // don't re-fire the same token. Replaces a plain boolean that couldn't tell a
  // new deep-link from a re-render.
  const consumedVoiceToken = useRef<string | null>(null);

  function setFreshDraft(d: MealDraft | null) {
    setDraft(d);
    // Every fresh capture, parse and «очистить» goes through here, so this is
    // the one place that has to remember it: a hand-typed name belonged to the
    // meal being replaced, not to the new one. Sprinkling the reset across the
    // five call sites instead would work until someone adds a sixth.
    setTitleTouched(false);
  }

  /**
   * The entry's name follows its dishes (tester feedback 2026-08-12, items 1–2):
   * remove «хлеб» from the plate and it leaves the name too, instead of the name
   * staying frozen on whatever sentence produced the first parse.
   *
   * Runs off `draft`, so EVERY path that changes the dishes is covered — parse,
   * re-parse, weight edits, «не то?», «из моего рациона», delete — without each
   * of them having to remember to touch the title.
   *
   * Two deliberate exemptions:
   * - `titleTouched`: once the user renames the meal by hand, that wins. Their
   *   words are not a stale derivation to be corrected.
   * - an EMPTY draft: keep whatever is in the field. That is the user's own
   *   sentence or dictation, and blanking it would throw away the only record of
   *   what they said in exactly the case where nothing was recognised (item 3).
   */
  useEffect(() => {
    if (titleTouched) return;
    const items = draft?.items ?? [];
    if (items.length === 0) return;
    const derived = mealTitle(items, region);
    if (derived.length === 0) return;
    setText((prev) => (prev === derived ? prev : derived));
  }, [draft, region, titleTouched]);

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
        // The lookahead shot is registered as THE in-flight parse and still
        // sits in the queue — passing it in `queued` too would mint a second
        // pending row and re-bill the same photo.
        const prefetchedUri = prefetchRef.current?.uri;
        adoptOnUnmount(dbRef.current, {
          queued: photoQueueRef.current.filter((p) => p.uri !== prefetchedUri),
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
      // A shot/clip still waiting on the consent modal is neither adopted nor
      // queued — walking away (system back) would strand its file in cache
      // forever, one per abandoned first-time photo/voice log.
      if (pendingPhotoRef.current && !isAdopted(pendingPhotoRef.current.uri)) {
        deleteTempFile(pendingPhotoRef.current.uri);
      }
      if (pendingAudioRef.current) deleteTempFile(pendingAudioRef.current.uri);
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
      setCommunityShare(settings.communityFoodShare);
      setQuick(quickAdd);
    })();
    return () => {
      active = false;
    };
  }, [db]);

  /// One tap re-loads a past meal as an already-confirmed draft (no parse) — the
  /// user still reviews and saves. The item carries the entry's REAL portion
  /// grams when they're stored ([itemFromQuickMeal]) — «за 100 г» on a 300-g
  /// meal was the кесадилья bug (device report 2026-08-21).
  function onQuickPick(meal: QuickMeal) {
    setText(meal.rawText);
    setSource('text');
    setParseIssue(null);
    setFreshDraft(recomputeDraft(region, [itemFromQuickMeal(meal)]));
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
    // The name is not appended here any more: it follows the dishes through the
    // title effect, so a food picked and then removed also leaves the name.
  }

  /// Run the text parse with a known consent value. `getFoodParser` only goes
  /// online when AI is configured AND consent is true; otherwise it's the stub.
  // Re-apply the user's remembered per-food corrections (disambiguation layer 2)
  // to a freshly parsed draft, so a fix made once sticks on the next log.
  async function applyMemory(draft: MealDraft): Promise<MealDraft> {
    if (!db) return draft;
    const choices = await loadRememberedChoices(db, region, draft);
    const applied = applyRememberedChoices(draft, region, choices);
    // `recomputeDraft` inside rebuilds the draft FROM ITS ITEMS, so anything not
    // derived from items has to be carried across by hand — and losing `heard`
    // here would silently undo the whole point of the server sending it.
    return draft.heard && !applied.heard ? { ...applied, heard: draft.heard } : applied;
  }

  /// After any parse: surface HOW the draft was produced. `offline_fallback`
  /// means the user expected the online parser and silently got the stub — say
  /// so instead of passing degraded numbers off as an AI parse. Only flagged
  /// when online was actually expected (AI configured + consented). ONE message
  /// per outcome: photo/voice can't be parsed offline at all, and an empty
  /// offline text parse explains itself — the generic «не удалось распознать»
  /// hint stays out of the way then (it used to stack contradictorily).
  function acceptDraft(parsed: MealDraft, consentNow: boolean, kind: 'text' | 'photo' | 'audio') {
    // `setFreshDraft` also clears any hand-typed name: the parse consumed the
    // field as input, so it goes back to being derived. The title itself is set
    // by the effect watching `draft` — including the «борщ, хлеб, сметана» echo
    // that makes a voice/photo parse visible up top, which used to be written
    // here and only when the field happened to be empty.
    setFreshDraft(parsed);
    // Nothing was recognised, but the person still said something. On the voice-
    // note path their words only exist in `heard` — the clip was understood on
    // the server — so this is the last chance to put them back on screen. With
    // items present the derived title says the same thing better, and the effect
    // above owns the field.
    const heard = parsed.heard?.trim() ?? '';
    if (parsed.items.length === 0 && heard.length > 0) setText(heard);
    const offline = AI_CONFIGURED && consentNow && parsed.flags.offline_fallback;
    setParseIssue(
      !offline
        ? null
        : // The per-install AI budget is spent (429) — «нет интернета» would be
          // a lie the user can see through; the remedy is the manual/chip paths,
          // not hunting for signal. WHICH budget decides the sentence: the paid
          // one comes back at midnight, the free trial never does, and promising
          // «завтра снова заработает» to someone whose trial is gone is the
          // worse of the two possible lies.
          parsed.flags.quota_exceeded
          ? getAiQuotaScope() === 'total'
            ? 'quotaFree'
            : 'quota'
          : // The build has no API token, so EVERY parse here fails the same way.
            // Checked before the others: it is the one cause the user genuinely
            // cannot work around, and mislabelling it sends a whole test group
            // to inspect a connection that is fine.
            parsed.flags.auth_error
            ? 'misconfigured'
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
    setQuotaScope(getAiQuotaScope());
  }

  /**
   * What the screen should show after a TEXT parse, given what is already there.
   *
   * «Забыл указать кофе» (tester feedback 2026-08-12, item 4): the field holds
   * the complete dish list, so adding the missing one and parsing again is the
   * natural move — and it only works because the title is derived and complete.
   * Two things must survive it:
   *
   * - the weights and matches the user already fixed ([mergeReparsedDraft]);
   * - the plate itself when the parse understands NOTHING. An empty result
   *   replacing a built-up meal would delete real work over one unrecognised
   *   word, so the dishes stay and only the explanatory message changes.
   */
  function nextDraftFromTextParse(parsed: MealDraft): MealDraft {
    // The ref, not the closure: the state captured when the parse was tapped
    // is stale by the time the response lands (see draftRef above).
    const current = draftRef.current;
    if (parsed.items.length > 0) return mergeReparsedDraft(current, parsed, region);
    if (!current || current.items.length === 0) return parsed;
    // Keep the dishes, but carry over the CLIENT-side flags (offline, quota,
    // auth, server error) so `acceptDraft` still explains what went wrong.
    const kept = recomputeDraft(region, current.items);
    return {
      ...kept,
      flags: {
        ...kept.flags,
        offline_fallback: parsed.flags.offline_fallback,
        server_error: parsed.flags.server_error,
        quota_exceeded: parsed.flags.quota_exceeded,
        auth_error: parsed.flags.auth_error,
      },
    };
  }

  async function runTextParse(consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    try {
      const parsed = await applyMemory(await getFoodParser(consentNow).parse(text, region));
      acceptDraft(nextDraftFromTextParse(parsed), consentNow, 'text');
    } catch {
      // A throw here is not the network (that falls back inside the parser) —
      // it's something local (db read). Still: never fail into silence.
      setParseIssue('failed');
    } finally {
      setParsing(false);
    }
  }

  /// Quietly start the NEXT queued photo's parse while the current one sits on
  /// screen for review (lookahead of exactly 1). Registered as the in-flight
  /// parse so leaving the screen adopts THIS running request instead of billing
  /// the same photo a second time.
  function prefetchNext(consentNow: boolean, justParsedUri: string) {
    const next = photoQueueRef.current[0];
    // The uri guard is belt-and-suspenders against a stale ref still holding
    // the shot whose parse just landed (the queue is dequeued synchronously on
    // advance, but a skipped prefetch beats a double-billed photo).
    if (!next || !consentNow || next.uri === justParsedUri) return;
    if (prefetchRef.current?.uri === next.uri) return;
    const promise = getFoodParser(consentNow).parsePhoto(next, region);
    // Errors are handled (with UI) when the advance consumes this promise.
    promise.catch(() => undefined);
    registerInFlight({ promise, photo: next });
    prefetchRef.current = { uri: next.uri, promise };
  }

  async function runPhotoParse(photo: PhotoInput, consentNow: boolean) {
    setParsing(true);
    setParseIssue(null);
    // A batch advance may find its parse already running (or done): the
    // lookahead above started it during the previous shot's review.
    const pre = prefetchRef.current?.uri === photo.uri ? prefetchRef.current : null;
    if (pre) prefetchRef.current = null;
    // The promise is captured BEFORE the await so that leaving the screen
    // mid-parse can hand this exact in-flight request to the background
    // service — adoption must not re-bill a parse that is seconds from landing.
    const parseP = pre?.promise ?? getFoodParser(consentNow).parsePhoto(photo, region);
    registerInFlight({ promise: parseP, photo });
    try {
      const parsed = await parseP;
      // Screen died mid-parse and the service took over: it writes the entry
      // itself — this (possibly unmounted) closure stands down.
      if (isAdopted(photo.uri)) return;
      acceptDraft(await applyMemory(parsed), consentNow, 'photo');
      // Pipeline the batch — but not off the offline/quota stub: every queued
      // parse would fail the same way, burning a request to learn nothing.
      if (!parsed.flags.offline_fallback) prefetchNext(consentNow, photo.uri);
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

  /// Consent that is BOTH given and current. A stale one (the disclosure version
  /// moved after a sub-processor change) is not consent: it falls back to the
  /// offline stub, exactly like no consent at all.
  function consentCurrent(): boolean {
    return (
      aiConsent &&
      !needsAiConsent({ aiFoodParseConsent: aiConsent, aiFoodParseConsentVersion: aiConsentVersion })
    );
  }

  // Manual DB search for one item ("найти вручную") and the swap when the user
  // picks a result. The query text goes to the same online parser, so it is
  // gated like a parse.
  function onItemSearch(query: string): Promise<NutritionAlternative[]> {
    return getFoodParser(consentCurrent()).searchFoods(query, region);
  }

  /// «Общая база» — the by-name way into the dishes other people entered.
  ///
  /// Same online endpoint as the per-item «найти вручную» picker (the shared
  /// base is one more source in it), so it is gated identically: consent must
  /// exist AT THE CURRENT disclosure version, or the app is holding the offline
  /// stub and there is nothing to search.
  async function onBaseSearch() {
    const query = baseQuery.trim();
    if (query.length === 0) return;
    setBaseSearching(true);
    try {
      setBaseResults(await onItemSearch(query));
    } finally {
      setBaseSearching(false);
    }
  }

  /// A dish picked out of the search results joins the draft exactly like one
  /// picked from «мой рацион»: appended at 100 g with the weight still to be
  /// typed. `userChosen` because it WAS chosen — that is what makes it stick in
  /// the personal journal on save.
  function onBasePick(found: NutritionAlternative) {
    onMemoryPick({ name: found.name, per100: found.per100 });
    setBaseResults(null);
    setBaseQuery('');
    setBaseOpen(false);
  }

  /**
   * Считан штрихкод. Это единственный путь добавления еды, который НЕ зовёт
   * модель: код опознаёт товар точно, поэтому сервер просто ищет его в базе и
   * отвечает за миллисекунды, не списывая разбор из квоты.
   *
   * Промах объясняем ЧЕСТНО и по-разному: кода нет в базе — предлагаем снять
   * состав с упаковки (фото этикетки уже умеет давать точные числа); база не
   * ответила — это не «такого продукта нет», и повтор имеет смысл.
   */
  async function onBarcode(code: string) {
    if (barcodeBusy) return;
    setBarcodeBusy(true);
    setBarcodeOutcome(null);
    try {
      const { item, name } = await getFoodParser(consentCurrent()).lookupBarcode(code, region);
      if (!item) {
        // Три разных «нет» — три разных фразы: источник молчит, товар опознан но
        // состава нигде нет, или кода не знает никто.
        setBarcodeOutcome(
          searchSourcesDown()
            ? { kind: 'unavailable' }
            : name
              ? { kind: 'identified', name }
              : { kind: 'missing' },
        );
        return;
      }
      setSource('text');
      setParseIssue(null);
      setDraft((prev) => recomputeDraft(region, [...(prev?.items ?? []), item]));
      setBarcodeOutcome({ kind: 'found', name: item.name_ru, kcal: Math.round(item.scaled.kcal) });
    } catch {
      setBarcodeOutcome({ kind: 'unavailable' });
    } finally {
      setBarcodeBusy(false);
    }
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
    // The lookahead parse (if any) is unregistered FIRST: an unmount right
    // after must not adopt — and save — a shot the user just discarded.
    if (prefetchRef.current) {
      clearInFlight(prefetchRef.current.uri);
      prefetchRef.current = null;
    }
    for (const p of photoQueue) deleteTempFile(p.uri);
    setPhotoQueue([]);
    setBatchTotal(0);
  }

  // Effective meal-of-day: the user's tap wins; until they touch the chips the
  // preselect is honest intent — a typed «завтрак…» keyword first, else the clock.
  const mealChoice: MealType = meal ?? mealTypeForEntry(text, new Date());

  // Whether the entry is aimed at today — gates the DayNav hint and the
  // today-phrased insight lines under the total (a save into yesterday must
  // not claim it moved TODAY's protein).
  const isTodaySelected = day === localDayKey(new Date());

  // Voice is offered when EITHER the AI voice-note recorder or on-device
  // dictation is available; the segment only lists methods the device actually
  // has, so it collapses to nothing when text is the only path.
  const voiceMode = (AI_CONFIGURED && recordingAvailable) || speechAvailable;
  /// Drop one dish from the parse draft — the «добавил лишнее, а удалить
  /// нельзя» gap (device feedback 2026-07-20). Removing the last item closes
  /// the draft entirely: an empty result must not pretend to be a meal.
  function onItemRemove(index: number) {
    // Remount the remaining cards (see itemsGen): the successor must not
    // inherit the removed dish's typed macros or open search panel.
    setItemsGen((g) => g + 1);
    setDraft((prev) => {
      if (!prev) return prev;
      const items = prev.items.filter((_, i) => i !== index);
      return items.length > 0 ? recomputeDraft(prev.region, items) : null;
    });
  }

  // Сканер показываем там же, где и фото: он тоже про камеру и тоже бесполезен
  // без онлайн-парсера (база продуктов живёт на сервере).
  const visibleModes = (['text', 'voice', 'photo', 'barcode'] as const).filter((m) =>
    m === 'text' ? true : m === 'voice' ? voiceMode : m === 'photo' ? photoAvailable : AI_CONFIGURED,
  );

  // One «Быстро» lane instead of three stacked headers («Как вчера»/«Избранное»/
  // «Недавнее» read as four near-identical uppercase sections). Priority
  // yesterday → favorites → recents, deduped by the meal text so a meal eaten
  // yesterday AND recently shows once.
  const quickPickList = (() => {
    const seen = new Set<string>();
    const deduped = [...quick.yesterday, ...quick.favorites, ...quick.recents].filter((m) => {
      const key = m.rawText.trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Current meal-of-day leads: logging завтрак surfaces breakfast history first,
    // обед/ужин follow — reordered ahead of the slice so a breakfast dish isn't
    // truncated away by a run of lunch/dinner recents. Stable within each
    // partition (yesterday→favorites→recents holds); reacts live to the meal
    // chips through `mealChoice`.
    return orderByMeal(deduped, mealChoice).slice(0, 8);
  })();

  async function onSave() {
    if (!draft || !db) return;
    setSaving(true);
    setSaveIssue(false);
    try {
      // A past day gets the same clock time on THAT day (the workout card's
      // whenForDay idiom): nobody knows when the unlogged meal actually was,
      // and this keeps the day's rows in the order they were entered. Today
      // keeps the plain «now» default.
      await saveParsedEntry(db, {
        rawText: text,
        source,
        draft,
        meal: mealChoice,
        ...(day !== localDayKey(new Date()) ? { ts: tsOnDay(new Date(), day) } : {}),
      });
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
        // 'history' is a MEAL echo, not a food: its per-100g is derived from a
        // whole-portion total (or IS the total for gramless legacy entries).
        // Remembering it poisoned «Из моего рациона» with «900 ккал/100 г»
        // кесадильями (device report 2026-08-21) — the meal already lives in
        // the «Быстро» lane, the journal adds nothing here.
        const realSource = src !== 'estimate' && src !== 'ai_estimate' && src !== 'history';
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
      // Offer the dishes the user typed the numbers for to the SHARED base, so
      // the next person who logs «шаурма» finds them instead of typing them
      // again. Fire-and-forget on purpose: the meal is already saved, the send
      // carries a food name and a per-100g and nothing else, and a failure is
      // not the user's problem to see (contributeFood never rejects). Off unless
      // BOTH the setting and a current AI consent say yes — without consent the
      // app holds the offline parser, whose contribute is a no-op anyway.
      if (communityShare && consentCurrent()) {
        const parser = getFoodParser(true);
        for (const food of contributableFoods(draft, region)) {
          void parser.contributeFood(food, region);
        }
      }
      // Warm, rotating acknowledgment of the *act* of logging (SDT relatedness)
      // — never a score or a limit. Briefly shown, then we return to Home.
      // A past-day save says WHICH day instead: the entry is about to be
      // invisible on the today list, so the ack is the proof it landed where
      // it was aimed (the workout card's «занесено в другой день» idiom).
      setSavedAck(
        day !== localDayKey(new Date())
          ? t('food.savedOtherDay', { day: formatDayTitle(day, t) })
          : pickVariant(
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
        // Sync the ref NOW: `next`'s prefetched parse may already be resolved,
        // and its continuation (which prefetches the shot after) runs on a
        // microtask — before the re-render that would re-sync the ref.
        photoQueueRef.current = rest;
        setSaving(false);
        startPhoto(next);
        return;
      }
      setBatchTotal(0);
      // Land on the day's food list (not a bare back to Home) so the just-saved
      // entry is visibly there and can be reopened/edited.
      //
      // `dismissTo`, NOT `replace` (device feedback 2026-08-19: «записал 3-4 еды
      // — из главного меню выкидывает обратно в еду»). The day list is where the
      // «+ Добавить» that opened this screen lives, so it is ALREADY on the
      // stack: `replace` swapped the log screen for a SECOND «Еда» on top of the
      // first, and every meal logged in one sitting stacked one more. Four meals
      // → four back presses that each land on «Еда» again before Home appears.
      // `dismissTo` pops back to the existing «Еда» when there is one, and
      // replaces the current screen (exactly the old behavior) when there isn't
      // — the Home mic/text FAB path, which never had a day list behind it.
      exitTimerRef.current = setTimeout(() => router.dismissTo('/food'), 1100);
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
    // Same microtask race as the save-path advance: keep the ref honest before
    // a resolved prefetch promise reads it.
    photoQueueRef.current = rest;
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

  /// «Общая база блюд» — the by-name way IN to what other people entered.
  ///
  /// A collapsed link until asked for, because it is the RARE path: most meals
  /// parse, and a wall of search UI above the parse button would suggest typing
  /// is not enough. It opens where «Из моего рациона» already sits — the two
  /// answer the same question («добавить блюдо, не разбирая текст») from the
  /// two places the numbers can come from: your own past, and everyone else's.
  ///
  /// Only when the online parser is actually reachable: offline there is nothing
  /// behind the field, and a search box that always answers «ничего не найдено»
  /// is worse than a line saying why.
  const communityBaseSection = AI_CONFIGURED ? (
    <View style={styles.quick}>
      <View style={styles.quickGroup}>
        <Pressable onPress={() => setBaseOpen((v) => !v)} hitSlop={6} accessibilityRole="button">
          <Text style={[styles.baseToggle, { color: theme.primary }, theme.font.bodySemiBold]}>
            {baseOpen ? t('food.community.hide') : t('food.community.open')}
          </Text>
        </Pressable>
        {baseOpen ? (
          !consentCurrent() ? (
            <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
              {t('food.community.offline')}
            </Text>
          ) : (
            <>
              <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
                {t('food.community.hint')}
              </Text>
              <View style={styles.baseRow}>
                <TextField
                  value={baseQuery}
                  onChangeText={setBaseQuery}
                  onSubmitEditing={onBaseSearch}
                  placeholder={t('food.community.placeholder')}
                  style={styles.baseInput}
                />
                <Pressable
                  onPress={onBaseSearch}
                  disabled={baseSearching || baseQuery.trim().length === 0}
                  style={({ pressed }) => [
                    styles.baseBtn,
                    {
                      borderColor: theme.separator,
                      backgroundColor: theme.card,
                      opacity: pressed || baseSearching ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: theme.primary }, theme.font.bodySemiBold]}>
                    {baseSearching ? t('food.community.searching') : t('food.community.action')}
                  </Text>
                </Pressable>
              </View>
              {baseResults != null && baseResults.length === 0 && !baseSearching ? (
                <Text style={[styles.hint, { color: theme.subtle }, theme.font.body]}>
                  {/* «появится для остальных» is a promise — with the shared
                      base OFF on the server the contribute is dropped, so the
                      copy switches to an honest one. Unknown (older server,
                      offline stub) keeps the normal text. And before either:
                      «пока такого блюда нет» is only sayable when the sources
                      actually answered — a dead one gets its own sentence. */}
                  {t(
                    searchSourcesDown()
                      ? 'food.community.unavailable'
                      : communityBaseAvailable() === false
                        ? 'food.community.emptyOff'
                        : 'food.community.empty',
                  )}
                </Text>
              ) : null}
              <View style={styles.quickWrap}>
                {(baseResults ?? []).map((found, i) => (
                  <Pressable
                    key={i}
                    onPress={() => onBasePick(found)}
                    style={({ pressed }) => [
                      styles.chip,
                      { backgroundColor: theme.card, borderColor: theme.separator, opacity: pressed ? 0.6 : 1 },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.chipText, { color: theme.text }, theme.font.bodySemiBold]}>
                      {found.name}
                    </Text>
                    {/* Provenance on every row, and the confirmation count where
                        there is one — «из общей базы · записей: 12» is the whole
                        difference between other people's numbers and a claim. */}
                    <Text style={[styles.chipMacro, { color: theme.subtle }, theme.font.body]}>
                      {[
                        hideCalories
                          ? `${t('macros.protein')} ${Math.round(found.per100.prot)} ${t('units.g')}`
                          : `${Math.round(found.per100.kcal)} ${t('units.kcal')} / 100 ${t('units.g')}`,
                        t(`food.source.${found.per100.source}`),
                        found.votes === undefined ? null : t('food.community.votes', { n: found.votes }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )
        ) : null}
      </View>
    </View>
  ) : null;

  // В режиме сканера экран занят ОДНИМ делом. Поле ввода, кнопка «Посчитать» и
  // ленты быстрого выбора к нему не относятся: они предлагают другой способ
  // добавить еду и тянут внимание на себя ровно в тот момент, когда человек
  // целится камерой в упаковку. Поэтому в этом режиме их нет — акцент там же,
  // где выбор пользователя. Результаты разбора ниже остаются: это ИТОГ работы
  // сканера, ради него всё и затевалось.
  // Поле прячем, только пока набирать нечего: когда блюда уже собраны, это поле
  // — ИМЯ приёма, то есть часть результата сканирования, а не конкурент ему.
  const scanning = inputMode === 'barcode';
  const hideComposer = scanning && draft == null;

  return (
    // The wait overlay must cover the WHOLE viewport (scrim over the scroll
    // content), so the scrolling Screen gets a plain flex wrapper around it.
    <View style={styles.screenWrap}>
    <Screen>
      {hideComposer ? null : (
      <>
      {/* Приём пищи — ПЕРВЫЙ вопрос экрана (фидбек владельца 2026-08-23):
          сначала КУДА пишем, потом что ели. Часы/ключевое слово в тексте только
          предлагают чип, тап решает. Выбор тут же ведёт плейсхолдер ниже и
          порядок лент «Из моего рациона» (текущий приём — первым). */}
      <View style={styles.mealPickTop}>
        <MealChips value={mealChoice} onChange={setMeal} />
      </View>
      {/* …и в какой ДЕНЬ — «вчера забыл записать ужин» теперь пишется сразу
          туда, без пересохранения через экран правки. Тот же DayNav, что на
          карточке тренировок: сегодня по умолчанию, стрелки — назад. */}
      <DayNav
        value={day}
        onChange={setDay}
        backDays={Math.max(DAY_NAV_BACK_DAYS, dayFloorExtra)}
        style={styles.dayNav}
      />
      {!isTodaySelected ? (
        <Text style={[styles.dayHint, { color: theme.subtle }, theme.font.body]}>
          {t('food.otherDayHint')}
        </Text>
      ) : null}
      <TextField
        value={text}
        onChangeText={(v) => {
          setText(v);
          // With a draft on screen this field IS the meal's name, so typing here
          // is a rename and must not be overwritten by the next dish edit. Before
          // a draft exists it is plain parse input and nothing is being renamed.
          if (draft) setTitleTouched(true);
          if (voiceError) setVoiceError(null);
          if (photoError) setPhotoError(null);
          if (!listening) setSource('text');
        }}
        placeholder={t(`food.prompt.${promptKeyForMeal(mealChoice)}`)}
        multiline
        style={styles.input}
      />
      </>
      )}
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
                onPress={() => {
                  // Карточка результата принадлежит сканеру: уходя из него,
                  // человек не должен возвращаться к ответу на прошлый код.
                  if (key !== 'barcode') setBarcodeOutcome(null);
                  setInputMode(key);
                }}
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
            {/* Разбор записи показывает WaitOverlay (в конце рендера) — тот же
                прогресс, что у текста и фото, без третьего инлайн-спиннера. */}
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
      {/* ШТРИХКОД: своя съёмка — камера смотрит на упаковку, рамка ждёт код
          внутри, кадры не покидают телефон (наружу уходят только 13 цифр).
          Ответ приходит за миллисекунды и не тратит разбор из квоты. */}
      {inputMode === 'barcode' ? (
        <BarcodeScanner
          onCode={(code) => void onBarcode(code)}
          busy={barcodeBusy}
          outcome={barcodeOutcome}
          onDismiss={() => setBarcodeOutcome(null)}
        />
      ) : null}
      {/* A photo parse runs up to ~25 s — the WaitOverlay at the end of this
          render shows a random signal-room scene over the dimmed screen. */}
      {scanning ? null : (
        <PrimaryButton
          label={parsing ? t('food.parsing') : t('food.parse')}
          onPress={onParse}
          disabled={parsing || listening || recording || text.trim().length === 0}
        />
      )}
      {/* Never fail into silence: say the server didn't answer (offline stub
          filled in) or that the parse broke — the button above IS the retry. */}
      {parseIssue ? (
        <>
          <Text style={[styles.parseIssue, { color: theme.subtle }, theme.font.body]}>
            {t(`food.parseIssue.${parseIssue}`)}
          </Text>
          {/* Only on the quota wall, and only as an offer: the sentence above
              already says the free budget returns tomorrow and that the manual
              paths still work. This is the shortcut for someone who would rather
              not wait — not a wall in front of the food they just ate. */}
          {parseIssue === 'quota' || parseIssue === 'quotaFree' ? (
            <Pressable
              onPress={() => router.push('/settings/subscription?from=limit')}
              hitSlop={8}
              accessibilityRole="link"
            >
              <Text style={[styles.parseIssue, { color: theme.primary }, theme.font.bodyMedium]}>
                {t('food.quotaSubscribe')}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : quotaLeft !== null && quotaLeft <= (quotaScope === 'total' ? FREE_QUOTA_WARN_AT : DAY_QUOTA_WARN_AT) ? (
        /* Honest heads-up instead of a surprise «лимит» at the day's fifth
           meal — rendered only once the server-reported budget runs low. The
           subscription link rides along here too: waiting for the wall to
           mention the remedy made the paid tier undiscoverable (owner
           feedback 2026-08-18). Same quiet link, one line, no modal. */
        <>
          <Text style={[styles.parseIssue, { color: theme.subtle }, theme.font.body]}>
            {quotaScope === 'total'
              ? t('food.quotaLeftTotal', { n: quotaLeft })
              : t('food.quotaLeft', { n: quotaLeft })}
          </Text>
          <Pressable
            onPress={() => router.push('/settings/subscription?from=limit')}
            hitSlop={8}
            accessibilityRole="link"
          >
            <Text style={[styles.parseIssue, { color: theme.primary }, theme.font.bodyMedium]}>
              {t('food.quotaSubscribe')}
            </Text>
          </Pressable>
        </>
      ) : null}

      {/* «Из моего рациона» — while IDLE it sits right under the parse button
          as a starting point. Once a draft exists it renders BELOW the results
          instead (see after the results block): a wall of diet chips above the
          cards buried what was just parsed off-screen, reading as «ничего не
          нашлось» (device feedback 2026-07-16). */}
      {draft == null && !scanning ? myDietSection : null}
      {draft == null && !scanning ? communityBaseSection : null}

      {draft == null && !scanning && quickPickList.length > 0 ? (
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
              key={`${itemsGen}-${i}`}
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

          {/* «Пауза» promises "цели выключены" — honour it here too, not only
              on Home (the banner alone doesn't stop this line from nagging).
              Both insight lines speak about TODAY (today's protein, today's
              variety) — writing into another day they'd be false, so they
              stand down until the day comes back to today. */}
          {proteinTarget > 0 && !paused && isTodaySelected ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }, theme.font.body]}>
              {t(proteinInsight(todayProteinG + draft.totals.prot, proteinTarget, Math.round(todayProteinG)))}
            </Text>
          ) : null}
          {varietyCount > 0 && isTodaySelected ? (
            <Text style={[styles.proteinNote, { color: theme.subtle }, theme.font.body]}>
              {t(varietyInsight(varietyCount))}
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
      {draft != null ? communityBaseSection : null}

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
    {/* Any parse in flight (text / voice clip / photo) → the signal-room scene
        in a centered card, everything else dimmed. One overlay instead of the
        three inline spinners that drowned in the screen's text (owner,
        2026-08-22). Deliberately outside the input-mode segment gate:
        switching tabs mid-parse must not hide the progress. The multi-photo
        LOOKAHEAD parse never sets `parsing`, so reviewing a shot while the
        next one parses stays undimmed. */}
    {parsing ? (
      <WaitOverlay
        label={
          source === 'photo'
            ? t('food.photoProcessing')
            : source === 'voice'
              ? t('food.voiceProcessing')
              : t('food.parsing')
        }
      />
    ) : null}
    </View>
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
  // The meal picker above the composer: its own air before the text field.
  mealPickTop: { marginBottom: 14 },
  // The day track under the chips (the workout card's spacing idiom).
  dayNav: { marginBottom: 10 },
  dayHint: { fontSize: 12, lineHeight: 17, marginTop: -4, marginBottom: 10 },
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
  // The WaitOverlay needs a non-scrolling ancestor covering the viewport.
  screenWrap: { flex: 1 },
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
  baseToggle: { fontSize: 14, marginBottom: 8 },
  baseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  baseInput: { flex: 1 },
  baseBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
});
