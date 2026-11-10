import React from 'react';
import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { applySchema } from '@/lib/core/db/init';
import { saveDiaryEntry, getDiaryEntry } from '@/lib/core/db/diary';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings, parseReminderTimes, updateSettings } from '@/lib/core/db/settings';
import i18n from '@/lib/i18n';
import { localDayKey } from '@/lib/i18n/formatDay';

const renderer = require('react-test-renderer');
let mockDb: ReturnType<typeof drizzle>;
let mockEditId: string | undefined;
const mockSchedule = jest.fn(async (_spec: unknown) => {});
const mockCancel = jest.fn(async () => {});
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, Linking: { openURL: jest.fn(), openSettings: jest.fn() },
  Pressable: 'Pressable', Text: 'Text', View: 'View', Switch: 'Switch',
  Animated: { Text: 'AnimatedText', Value: class { setValue() {} }, timing: () => ({ start() {}, stop() {} }) },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: () => {} }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useNavigation: () => ({ dispatch: jest.fn() }), useLocalSearchParams: () => mockEditId ? ({ id: mockEditId }) : ({}),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/lib/core/db/client', () => ({ getDbDriver: () => 'op-sqlite' }));
jest.mock('@/lib/core/db/DatabaseProvider', () => ({ useDatabase: () => mockDb }));
jest.mock('@/lib/core/services/notificationProvider', () => ({ getNotificationService: () => ({
  initialize: async () => {}, requestPermissions: async () => true,
  cancelAll: mockCancel, scheduleDaily: mockSchedule,
}) }));
jest.mock('@/lib/core/services/appActive', () => ({ useAppActiveEffect: () => {} }));
jest.mock('@/lib/core/services/backgroundParses', () => ({
  runningParseEntryIds: () => new Set(), subscribeBackgroundParses: () => () => {}, retryParse: jest.fn(),
}));
jest.mock('@/lib/core/db/healthSync', () => ({ syncDayHealth: async () => ({ steps: null, workoutSteps: 0 }) }));
jest.mock('@/lib/core/services/healthProvider', () => ({ getHealthService: () => ({}) }));
jest.mock('@/lib/theme/theme', () => ({ useTheme: () => ({ scheme: 'light', font: {} }) }));
jest.mock('@/lib/theme/motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/components/consent/ConsentModal', () => ({ ConsentModal: 'ConsentModal' }));
jest.mock('@/components/legal/LegalReader', () => ({ LegalReader: 'LegalReader' }));
jest.mock('@/components/ui/Card', () => ({ Card: 'Card' }));
jest.mock('@/components/ui/Chip', () => ({ Chip: 'Chip', ChipRow: 'ChipRow' }));
jest.mock('@/components/ui/ListGroup', () => ({ ListGroup: 'ListGroup' }));
jest.mock('@/components/ui/PrimaryButton', () => ({ PrimaryButton: 'PrimaryButton' }));
jest.mock('@/components/ui/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/ui/SectionHeader', () => ({ SectionHeader: 'SectionHeader' }));
jest.mock('@/components/ui/TextField', () => ({ TextField: 'TextField' }));
jest.mock('@/components/ui/MoodScale', () => ({ MoodScale: 'MoodScale' }));
jest.mock('@/components/ui/FillBar', () => ({ FillBar: 'FillBar' }));
jest.mock('@/components/ui/AccordionChevron', () => ({ AccordionChevron: 'AccordionChevron' }));
jest.mock('@/components/ui/DayNav', () => ({ DayNav: 'DayNav' }));
jest.mock('@/components/ui/RiseIn', () => ({ RiseIn: ({ children }: any) => children }));
jest.mock('@/components/ui/Collapsible', () => ({ Collapsible: ({ open, children }: any) => open ? children : null }));

const SettingsScreen = require('@/app/settings/index').default;
const DiaryNewScreen = require('@/app/diary/new').default;
const FoodDayScreen = require('@/app/food/index').default;
const { FoodTodayWidget } = require('@/components/home/FoodTodayWidget');
let tree: any;
let sqlite: BetterSqlite3.Database;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function textContent(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  return textContent(node.children);
}
const visibleText = () => textContent(tree.toJSON());
const field = (placeholder: string) => tree.root.findAllByType('TextField').find((n: any) => n.props.placeholder === placeholder);
const action = (label: string) => tree.root.findAllByType('Pressable').find((n: any) => n.props.accessibilityLabel === label);

beforeEach(async () => {
  mockEditId = undefined;
  sqlite = new BetterSqlite3(':memory:');
  mockDb = drizzle(sqlite, { schema });
  await applySchema((statement) => sqlite.exec(statement));
  await ensureSettings(mockDb);
});
afterEach(async () => {
  if (tree) await renderer.act(async () => tree.unmount());
  tree = null;
  sqlite.close();
  await i18n.changeLanguage('ru');
  jest.clearAllMocks();
});

it('rejects an invalid reminder visibly, keeps the input, and saves the corrected time', async () => {
  await renderer.act(async () => { tree = renderer.create(<SettingsScreen />); });
  await renderer.act(async () => { field(i18n.t('settings.reminderAdd')).props.onChangeText('25:61'); });
  await renderer.act(async () => { action(i18n.t('settings.reminderAddBtn')).props.onPress(); });
  expect(visibleText()).toContain(i18n.t('settings.reminderInvalid'));
  expect(field(i18n.t('settings.reminderAdd')).props.value).toBe('25:61');
  expect(parseReminderTimes((await ensureSettings(mockDb)).reminderTimes)).toEqual([]);
  expect(mockSchedule).not.toHaveBeenCalled();
  await renderer.act(async () => { field(i18n.t('settings.reminderAdd')).props.onChangeText('12:34'); });
  expect(visibleText()).not.toContain(i18n.t('settings.reminderInvalid'));
  await renderer.act(async () => { action(i18n.t('settings.reminderAddBtn')).props.onPress(); });
  const save = tree.root.findByType('PrimaryButton');
  await renderer.act(async () => { await save.props.onPress(); });
  expect(parseReminderTimes((await ensureSettings(mockDb)).reminderTimes)).toEqual(['12:34']);
  expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ hour: 12, minute: 34 }));
});

it('explains an empty emotion, then adds a trimmed name without losing the typed intensity', async () => {
  await renderer.act(async () => { tree = renderer.create(<DiaryNewScreen />); });
  await renderer.act(async () => { tree.root.findByType('PrimaryButton').props.onPress(); });
  await renderer.act(async () => { field('0–100').props.onChangeText('37'); });
  await renderer.act(async () => { field(i18n.t('diary.emotion.name')).props.onChangeText('   '); });
  await renderer.act(async () => { action(i18n.t('diary.emotion.add')).props.onPress(); });
  expect(visibleText()).toContain(i18n.t('diary.emotion.nameRequired'));
  expect(tree.root.findAllByType('Pressable').filter((n: any) => n.props.accessibilityLabel?.includes('Спокойствие'))).toHaveLength(0);
  await renderer.act(async () => { field(i18n.t('diary.emotion.name')).props.onChangeText('  Спокойствие  '); });
  expect(visibleText()).not.toContain(i18n.t('diary.emotion.nameRequired'));
  await renderer.act(async () => { action(i18n.t('diary.emotion.add')).props.onPress(); });
  expect(action(i18n.t('diary.emotion.remove', { name: 'Спокойствие' }))).toBeDefined();
  expect(visibleText()).toContain('Спокойствие · 37/100');
  expect(visibleText()).not.toContain('Спокойствие  ');
  expect(field(i18n.t('diary.emotion.name')).props.value).toBe('');
});

const diaryNext = async () => {
  await renderer.act(async () => { await tree.root.findByType('PrimaryButton').props.onPress(); });
};
const diaryWrite = async (placeholder: string, value: string) => {
  await renderer.act(async () => { field(placeholder).props.onChangeText(value); });
};
const diaryAction = async (label: string) => {
  await renderer.act(async () => { action(label).props.onPress(); });
};
const diaryBack = async () => {
  const back = tree.root.findAllByType('Pressable').find((n: any) => textContent(n) === i18n.t('diary.back'));
  await renderer.act(async () => { back.props.onPress(); });
};
async function basicDiary() {
  await renderer.act(async () => { tree = renderer.create(<DiaryNewScreen />); });
  await diaryWrite(i18n.t('diary.steps.situation.placeholder'), 'Snow');
  await diaryNext();
  await diaryWrite(i18n.t('diary.emotion.name'), 'Joy');
  await diaryWrite('0–100', '37');
  await diaryNext(); // auto-add pending emotion
  await diaryNext(); // reaction
  await diaryWrite(i18n.t('diary.steps.thoughts.placeholder'), 'I enjoy the snow');
}

it('finishes a basic record after four steps without asking for meanings or a reframe', async () => {
  await basicDiary();
  expect(tree.root.findByType('PrimaryButton').props.label).toBe(i18n.t('diary.save'));
  expect(visibleText()).toContain(i18n.t('diary.progress', { current: 4, total: 4 }));
  expect(field(i18n.t('diary.steps.meaning.placeholder'))).toBeUndefined();
  expect(field(i18n.t('diary.reframePlaceholder'))).toBeUndefined();
  await diaryWrite('0–100', '100');
  await diaryNext(); // Save is the basic finish, no hidden extra screens
  const rows = await mockDb.select().from(schema.diaryEntries);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ thoughtBelief: 100, coreBelief: '', reframe: '' });
  expect(JSON.parse(rows[0].emotions)).toEqual([{ name: 'Joy', intensity: 37 }]);
  expect(JSON.parse(rows[0].meanings)).toEqual([]);
});

it('opens thought evaluation only by choice and keeps its answers when returning to basic', async () => {
  await basicDiary();
  await diaryAction(i18n.t('diary.optional.review'));
  expect(visibleText()).toContain(i18n.t('diary.steps.evidence.title'));
  expect(field(i18n.t('diary.steps.meaning.placeholder'))).toBeUndefined();
  await diaryWrite(i18n.t('diary.evidence.forPlaceholder'), 'It is snowing');
  await diaryBack();
  expect(tree.root.findByType('PrimaryButton').props.label).toBe(i18n.t('diary.save'));
  await diaryAction(i18n.t('diary.optional.review'));
  expect(field(i18n.t('diary.evidence.forPlaceholder')).props.value).toBe('It is snowing');
  await diaryNext();
  await diaryWrite(i18n.t('diary.reframePlaceholder'), 'Enjoy this moment');
  await diaryNext();
  const rows = await mockDb.select().from(schema.diaryEntries);
  expect(rows[0].evidenceFor).toBe('It is snowing');
  expect(rows[0].reframe).toBe('Enjoy this moment');
  expect(JSON.parse(rows[0].meanings)).toEqual([]);
});

it('adds each deeper question and the self-question only when requested', async () => {
  await basicDiary();
  await diaryAction(i18n.t('diary.optional.meaning'));
  expect(tree.root.findByType('PrimaryButton').props.label).toBe(i18n.t('diary.save'));
  expect(visibleText()).not.toContain(i18n.t('diary.steps.coreBelief.title'));
  await diaryWrite(i18n.t('diary.steps.meaning.placeholder'), 'A chance to feel joy');
  await diaryAction(i18n.t('diary.meaning.deepen'));
  await diaryWrite(i18n.t('diary.steps.meaning.deeperPlaceholder'), 'Feeling carefree');
  await diaryAction(i18n.t('diary.meaning.deepen'));
  await diaryWrite(i18n.t('diary.steps.meaning.deeperPlaceholder'), 'I can rest');
  await diaryBack();
  expect(field(i18n.t('diary.steps.meaning.deeperPlaceholder')).props.value).toBe('Feeling carefree');
  await diaryNext();
  expect(field(i18n.t('diary.steps.meaning.deeperPlaceholder')).props.value).toBe('I can rest');
  await diaryAction(i18n.t('diary.meaning.exploreSelf'));
  await diaryWrite(i18n.t('diary.steps.coreBelief.placeholder'), 'I can enjoy small things');
  await diaryNext();
  const rows = await mockDb.select().from(schema.diaryEntries);
  expect(rows[0].coreBelief).toBe('I can enjoy small things');
  expect(rows[0].reframe).toBe('');
  expect(JSON.parse(rows[0].meanings)).toEqual(['A chance to feel joy', 'Feeling carefree', 'I can rest']);
});

it('keeps all previously saved optional answers when an existing entry is edited as basic', async () => {
  const id = await saveDiaryEntry(mockDb, {
    situation: 'Walk', thoughts: 'I can rest', emotions: [{ name: 'Calm', intensity: 62 }],
    reactionBody: 'Relaxed', reactionBehavior: 'Walked', thoughtBelief: 0,
    meanings: ['Space to breathe', 'I have time'], coreBelief: 'I can pause',
    evidenceFor: 'Time off', evidenceAgainst: 'Nothing urgent', reframe: 'Rest is possible', mood: 8,
  });
  mockEditId = String(id);
  await renderer.act(async () => { tree = renderer.create(<DiaryNewScreen />); });
  await diaryNext(); await diaryNext(); await diaryNext();
  expect(tree.root.findByType('PrimaryButton').props.label).toBe(i18n.t('diary.update'));
  expect(visibleText()).toContain(i18n.t('diary.optional.saved'));
  await diaryWrite(i18n.t('diary.steps.thoughts.placeholder'), 'I can choose a slower pace');
  await diaryNext();
  const saved = await getDiaryEntry(mockDb, id);
  expect(saved).toMatchObject({
    thoughts: 'I can choose a slower pace', thoughtBelief: 0,
    meanings: ['Space to breathe', 'I have time'], coreBelief: 'I can pause',
    evidenceFor: 'Time off', evidenceAgainst: 'Nothing urgent', reframe: 'Rest is possible', mood: 8,
  });
});

it('keeps an invalid belief on the thought step instead of entering an optional path', async () => {
  await basicDiary();
  await diaryWrite('0–100', '101');
  await diaryAction(i18n.t('diary.optional.meaning'));
  expect(field('0–100').props.value).toBe('101');
  expect(visibleText()).toContain(i18n.t('diary.progress', { current: 4, total: 4 }));
  await diaryWrite('0–100', '0');
  await diaryNext();
  const rows = await mockDb.select().from(schema.diaryEntries);
  expect(rows[0].thoughtBelief).toBe(0);
});

it('uses protein progress in the Home food widget when calories are hidden and restores calorie mode', async () => {
  const props = { kcal: 356, targetKcal: 2223, prot: 24, targetProt: 120, fat: 18, targetFat: 60,
    carb: 29, targetCarb: 250, targetApprox: true, movementHint: 'ENERGY_BUDGET_HINT', onPress: jest.fn() };
  await renderer.act(async () => { tree = renderer.create(<FoodTodayWidget {...props} hideCalories />); });
  expect(visibleText()).not.toContain(i18n.t('units.kcal'));
  expect(visibleText()).not.toContain('356');
  expect(visibleText()).not.toContain('2223');
  expect(visibleText()).not.toContain('ENERGY_BUDGET_HINT');
  expect(visibleText()).toContain(i18n.t('macros.protein'));
  expect(tree.root.findByType('FillBar').props).toMatchObject({ value: 24, min: 120 });
  await renderer.act(async () => { tree.update(<FoodTodayWidget {...props} hideCalories={false} />); });
  expect(visibleText()).toContain(i18n.t('units.kcal'));
  expect(visibleText()).toContain('356');
  expect(visibleText()).toContain('ENERGY_BUDGET_HINT');
  expect(tree.root.findByType('FillBar').props).toMatchObject({ value: 356, min: 2223 });
});

it('honors stored calorie privacy for meal headers, food cards, expanded ingredients, and a past day', async () => {
  await updateSettings(mockDb, { hideCalories: true });
  const [entry] = await mockDb.insert(schema.foodEntries).values({ ts: new Date(), rawText: 'Омлет', source: 'text',
    kcal: 178, proteinG: 12, fatG: 14, carbG: 3, confirmed: true, meal: 'breakfast' }).returning({ id: schema.foodEntries.id });
  await mockDb.insert(schema.foodItems).values({ entryId: entry.id, name: 'Яйцо', qtyG: 120,
    kcal: 178, proteinG: 12, fatG: 14, carbG: 3, source: 'manual' });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await mockDb.insert(schema.foodEntries).values({ ts: yesterday, rawText: 'Вчерашний омлет', source: 'text',
    kcal: 179, proteinG: 13, fatG: 14, carbG: 3, confirmed: true, meal: 'breakfast' });
  await renderer.act(async () => { tree = renderer.create(<FoodDayScreen />); });
  expect(visibleText()).toContain('Омлет');
  expect(visibleText()).not.toContain(i18n.t('units.kcal'));
  const row = tree.root.findAllByType('Card').find((n: any) => typeof n.props.onPress === 'function');
  await renderer.act(async () => { row.props.onPress(); });
  expect(visibleText()).toContain('Яйцо');
  expect(visibleText()).toContain('120');
  expect(visibleText()).not.toContain('178');
  expect(visibleText()).not.toContain(i18n.t('units.kcal'));
  await renderer.act(async () => { tree.root.findByType('DayNav').props.onChange(localDayKey(yesterday)); });
  expect(visibleText()).toContain('Вчерашний омлет');
  expect(visibleText()).not.toContain('179');
  expect(visibleText()).not.toContain(i18n.t('units.kcal'));
  await renderer.act(async () => { tree.unmount(); tree = null; });
  await updateSettings(mockDb, { hideCalories: false });
  await renderer.act(async () => { tree = renderer.create(<FoodDayScreen />); });
  expect(visibleText()).toContain('178');
  expect(visibleText()).toContain(i18n.t('units.kcal'));
});
