import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createElement } from 'react';

import { recomputeDraft, scaleToGrams } from '@/lib/core/services/mealDraft';
import type { MealDraft, NutritionItem } from '@/lib/core/services/foodParser';

// Keep the actual screen handlers/state transitions; only native UI/providers
// are substituted. No microphone, network, database or consent is exercised.
jest.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({}) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/lib/i18n', () => ({ currentLocale: () => 'ru' }));
jest.mock('@/lib/theme/theme', () => ({ useTheme: () => ({ font: {} }) }));
jest.mock('@/lib/core/db/DatabaseProvider', () => ({ useDatabase: () => mockDatabase }));
jest.mock('@/lib/core/db/settings', () => ({
  ensureSettings: async () => ({ region: 'RU', targetProteinG: 0, aiFoodParseConsent: true }),
}));
jest.mock('@/lib/core/db/food', () => ({
  ...jest.requireActual<typeof import('@/lib/core/db/food')>('@/lib/core/db/food'),
  todayMacroTotals: async () => ({ proteinG: 0 }),
  quickMeals: async () => ({ yesterday: [], favorites: [], recents: [] }), distinctFoodItemsToday: async () => 0,
}));
jest.mock('@/lib/core/db/foodChoices', () => ({
  listFoodChoices: async () => [], loadRememberedChoices: () => mockLoadChoices(),
}));
jest.mock('@/lib/core/consent/consent', () => ({ needsAiConsent: () => false, AI_CONSENT_VERSION: 'test' }));
jest.mock('@/lib/core/services/backgroundParses', () => ({ isAdopted: () => false, adoptOnUnmount: () => {} }));
jest.mock('@/lib/core/services/tempFiles', () => ({ deleteTempFile: jest.fn() }));
jest.mock('@/lib/core/services/photoProvider', () => ({ isPhotoCaptureAvailable: async () => true }));
jest.mock('@/lib/core/services/speechProvider', () => ({ getSpeechService: () => ({ initialize: async () => true, stop: async () => {}, listen: mockSpeechListen }) }));
jest.mock('@/lib/core/services/audioRecorder', () => ({
  isAudioRecordingAvailable: () => mockAudioAvailable,
  startRecording: () => mockStartRecording(),
  isSilentRecording: () => mockSilent,
}));
jest.mock('@/lib/core/services/foodParserProvider', () => ({
  resolveRegion: () => 'RU',
  getFoodParser: () => ({ parse: () => mockParse(), parseAudio: () => mockParseAudio() }),
}));
jest.mock('@/components/consent/ConsentModal', () => ({ ConsentModal: 'ConsentModal' }));
jest.mock('@/components/food/ItemCard', () => ({ ItemCard: 'ItemCard' }));
jest.mock('@/components/food/MealChips', () => ({ MealChips: 'MealChips' }));
jest.mock('@/components/food/BarcodeScanner', () => ({ BarcodeScanner: 'BarcodeScanner' }));
jest.mock('@/components/food/nutrientViews', () => ({ ApproxBadge: 'ApproxBadge', MicroScales: 'MicroScales', NutrientDetail: 'NutrientDetail' }));
jest.mock('@/components/ui/DayNav', () => ({ DAY_NAV_BACK_DAYS: 30, DayNav: 'DayNav' }));
jest.mock('@/components/ui/Card', () => ({ Card: 'Card' }));
jest.mock('@/components/ui/PrimaryButton', () => ({ PrimaryButton: 'PrimaryButton' }));
jest.mock('@/components/ui/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/ui/TextField', () => ({ TextField: 'TextField' }));
jest.mock('@/components/ui/Waveform', () => ({ Waveform: 'Waveform' }));
jest.mock('@/components/ui/wait/WaitOverlay', () => ({ WaitOverlay: 'WaitOverlay' }));

const { act } = require('react');
const { create } = require('react-test-renderer');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const originalConsoleError = console.error;
let rendererWarningFilter: { mockRestore: () => void };
beforeAll(() => {
  rendererWarningFilter = jest.spyOn(console, 'error').mockImplementation((message, ...args) => {
    // Expo54 already ships this renderer. Keep unrelated React errors visible.
    if (String(message).startsWith('react-test-renderer is deprecated.')) return;
    originalConsoleError(message, ...args);
  });
});
afterAll(() => { rendererWarningFilter.mockRestore(); });

function draft(name: string): MealDraft {
  const per100 = { source: 'manual' as const, kcal: 120, prot: 5, fat: 4, carb: 16, minerals: {} };
  const item: NutritionItem = {
    name_ru: name, name_en: name, grams: 125, grams_source: 'confirmed',
    confidence: 1, per100, scaled: scaleToGrams(per100, 125), approximate: false,
  };
  return recomputeDraft('RU', [item]);
}

const previous = draft('Previous meal');
const replacement = draft('New voice meal');
const mockParse = jest.fn<() => Promise<MealDraft>>();
const mockParseAudio = jest.fn<() => Promise<MealDraft>>();
let mockDatabase: object | null = null;
const mockLoadChoices = jest.fn<() => Promise<Map<string, never>>>();
const mockRecording = {
  stop: async () => ({ uri: 'file:///test-audio.m4a', mime: 'audio/mp4' }),
  peakLevel: () => 0,
  onMeter: () => () => {},
  cancel: jest.fn(async () => {}),
};
let mockSilent = true;
let mockAudioAvailable = true;
type Transcript = (text: string, isFinal: boolean) => void;
type SpeechEnd = (reason?: { code: string }) => void;
const mockSpeechListen = jest.fn<(onTranscript: Transcript, onEnd: SpeechEnd) => Promise<void>>();
const mockStartRecording = jest.fn<() => Promise<{ recording: typeof mockRecording } | { error: 'denied' }>>();
process.env.EXPO_PUBLIC_FOOD_API_URL = 'https://fixture.invalid/food/parse';
const FoodLogScreen = require('@/app/food/log').default;

// Native elements expose their existing handlers through these minimal hosts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let screen: any;
function input() { return screen.root.findByProps({ multiline: true }); }
function button(label: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = screen.root.findAllByType('Pressable').find((node: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    node.findAllByType('Text').some((text: any) => text.children.join('') === label),
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function seedPreviousMeal() {
  await act(async () => { screen = create(createElement(FoodLogScreen)); });
  await act(async () => { input().props.onChangeText('Original description'); });
  await act(async () => { await screen.root.findByProps({ label: 'food.parse' }).props.onPress(); });
  await act(async () => { input().props.onChangeText('Keep my title'); });
  await act(async () => { button('food.inputMode.voice').props.onPress(); });
}
function expectPreviousMeal() {
  expect(input().props.value).toBe('Keep my title');
  expect(screen.root.findByType('ItemCard').props.item).toEqual(previous.items[0]);
}

beforeEach(() => {
  mockDatabase = null;
  mockLoadChoices.mockResolvedValue(new Map<string, never>());
  mockSilent = true;
  mockAudioAvailable = true;
  mockParse.mockResolvedValue(previous);
  mockParseAudio.mockResolvedValue(replacement);
  mockStartRecording.mockResolvedValue({ recording: mockRecording });
  mockSpeechListen.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (screen) await act(async () => { screen.unmount(); });
  screen = null;
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('replacing a food draft with a voice recording', () => {
  it('keeps the title and complete draft while recording and after a silent stop', async () => {
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    expectPreviousMeal();
    await act(async () => { await button('food.voiceRecording').props.onPress(); });
    expectPreviousMeal();
    expect(mockParseAudio).not.toHaveBeenCalled();
  });

  it('keeps a complete draft after microphone permission is denied', async () => {
    mockStartRecording.mockResolvedValue({ error: 'denied' });
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    expectPreviousMeal();
  });

  it.each(['empty', 'failed'])('keeps the previous draft when recognition is %s', async (outcome) => {
    mockSilent = false;
    if (outcome === 'empty') mockParseAudio.mockResolvedValue(recomputeDraft('RU', []));
    else mockParseAudio.mockRejectedValue(new Error('fixture parse failed'));
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    await act(async () => { await button('food.voiceRecording').props.onPress(); });
    expectPreviousMeal();
  });

  it('replaces the previous meal only after successful recognition returns foods', async () => {
    mockSilent = false;
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    expectPreviousMeal();
    await act(async () => { await button('food.voiceRecording').props.onPress(); });
    expect(screen.root.findByType('ItemCard').props.item).toEqual(replacement.items[0]);
    expect(input().props.value).toBe('New voice meal');
  });

  it('shows heard words for manual correction when there was no previous input', async () => {
    mockSilent = false;
    mockParseAudio.mockResolvedValue({ ...recomputeDraft('RU', []), heard: 'A newly heard unknown dish' });
    await act(async () => { screen = create(createElement(FoodLogScreen)); });
    await act(async () => { button('food.inputMode.voice').props.onPress(); });
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    await act(async () => { await button('food.voiceRecording').props.onPress(); });
    expect(input().props.value).toBe('A newly heard unknown dish');
    expect(screen.root.findAllByType('ItemCard')).toHaveLength(0);
    expect(screen.root.findByProps({ label: 'food.parse' }).props.disabled).toBe(false);
  });

  it('keeps prior work instead of replacing it with only an unresolved transcript', async () => {
    mockSilent = false;
    mockParseAudio.mockResolvedValue({ ...recomputeDraft('RU', []), heard: 'An unresolved new sentence' });
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    await act(async () => { await button('food.voiceRecording').props.onPress(); });
    expectPreviousMeal();
  });

  it('does not overwrite edits made while the voice result is pending', async () => {
    mockSilent = false;
    let finish!: (value: MealDraft) => void;
    mockParseAudio.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    let stop!: Promise<boolean>;
    await act(async () => { stop = button('food.voiceRecording').props.onPress(); });
    await act(async () => { input().props.onChangeText('My newer edit wins'); });
    await act(async () => { finish(replacement); await stop; });
    expect(input().props.value).toBe('My newer edit wins');
    expect(screen.root.findByType('ItemCard').props.item).toEqual(previous.items[0]);
  });

  it('can cancel a stalled voice parse, retry, and ignore the old result without unlocking the new parse', async () => {
    mockSilent = false;
    let finishOld!: (value: MealDraft) => void;
    let finishNew!: (value: MealDraft) => void;
    mockParseAudio.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    await seedPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    let oldStop!: Promise<boolean>;
    await act(async () => { oldStop = button('food.voiceRecording').props.onPress(); });
    const overlay = screen.root.findByType('WaitOverlay');
    expect(overlay.props.label).toBe('food.voiceProcessing');
    await act(async () => { overlay.props.onCancel(); });
    expect(screen.root.findAllByType('WaitOverlay')).toHaveLength(0);
    expectPreviousMeal();
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    let newStop!: Promise<boolean>;
    await act(async () => { newStop = button('food.voiceRecording').props.onPress(); });
    await act(async () => { finishOld(draft('Obsolete result')); await oldStop; });
    expectPreviousMeal();
    expect(screen.root.findAllByType('WaitOverlay')).toHaveLength(1);
    await act(async () => { finishNew(replacement); await newStop; });
    expect(screen.root.findAllByType('WaitOverlay')).toHaveLength(0);
    expect(screen.root.findByType('ItemCard').props.item).toEqual(replacement.items[0]);
  });

  it('starts only one recorder while permission/start is pending', async () => {
    let finish!: (value: { recording: typeof mockRecording }) => void;
    mockStartRecording.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await seedPreviousMeal();
    let starting!: Promise<boolean>;
    await act(async () => { starting = button('food.voiceNote').props.onPress(); });
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    expect(mockStartRecording).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ recording: mockRecording }); await starting; });
    expectPreviousMeal();
    expect(button('food.voiceRecording')).toBeDefined();
  });

  it('shows a recognised voice meal even if remembered corrections never load', async () => {
    jest.useFakeTimers();
    mockDatabase = {};
    mockSilent = false;
    await seedPreviousMeal();
    mockLoadChoices.mockImplementation(() => new Promise(() => {}));
    await act(async () => { await button('food.voiceNote').props.onPress(); });
    let stopping!: Promise<boolean>;
    await act(async () => { stopping = button('food.voiceRecording').props.onPress(); });
    expect(screen.root.findAllByType('WaitOverlay')).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(2_001); await stopping; });
    expect(screen.root.findAllByType('WaitOverlay')).toHaveLength(0);
    expect(screen.root.findByType('ItemCard').props.item).toEqual(replacement.items[0]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels a recorder that finishes starting after the screen has closed', async () => {
    let finish!: (value: { recording: typeof mockRecording }) => void;
    mockStartRecording.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await seedPreviousMeal();
    let starting!: Promise<boolean>;
    await act(async () => { starting = button('food.voiceNote').props.onPress(); });
    await act(async () => { screen.unmount(); });
    screen = null;
    await act(async () => { finish({ recording: mockRecording }); await starting; });
    expect(mockRecording.cancel).toHaveBeenCalledTimes(1);
    expect(mockParseAudio).not.toHaveBeenCalled();
  });

  it('keeps a draft when on-device dictation fails before delivering words', async () => {
    mockAudioAvailable = false;
    let end!: SpeechEnd;
    mockSpeechListen.mockImplementation(async (_transcript, onEnd) => { end = onEnd; });
    await seedPreviousMeal();
    await act(async () => { await button('food.voice').props.onPress(); });
    await act(async () => { end({ code: 'not-allowed' }); });
    expectPreviousMeal();
  });

  it('ignores late dictation after the user edits the previous meal', async () => {
    mockAudioAvailable = false;
    let transcript!: Transcript;
    mockSpeechListen.mockImplementation(async (onTranscript) => { transcript = onTranscript; });
    await seedPreviousMeal();
    await act(async () => { await button('food.voice').props.onPress(); });
    await act(async () => { input().props.onChangeText('My edited title'); });
    await act(async () => { transcript('Late words', true); });
    expect(input().props.value).toBe('My edited title');
    expect(screen.root.findByType('ItemCard').props.item).toEqual(previous.items[0]);
  });

  it('ignores late dictation callbacks after an explicit stop', async () => {
    mockAudioAvailable = false;
    let transcript!: Transcript;
    mockSpeechListen.mockImplementation(async (onTranscript) => { transcript = onTranscript; });
    await seedPreviousMeal();
    await act(async () => { await button('food.voice').props.onPress(); });
    await act(async () => { await button('food.voiceListening').props.onPress(); });
    await act(async () => { transcript('Late words', true); });
    expectPreviousMeal();
  });
});
