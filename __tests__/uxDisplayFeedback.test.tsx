import React from 'react';
import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings, parseReminderTimes, updateSettings } from '@/lib/core/db/settings';
import i18n from '@/lib/i18n';
import { localDayKey } from '@/lib/i18n/formatDay';

const renderer = require('react-test-renderer');
let mockDb: ReturnType<typeof drizzle>;
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
  useNavigation: () => ({ dispatch: jest.fn() }), useLocalSearchParams: () => ({}),
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

it('guides meanings one at a time and saves a pending emotion and every answer', async () => {
  const next = async () => { await renderer.act(async () => { await tree.root.findByType('PrimaryButton').props.onPress(); }); };
  const write = async (placeholder: string, value: string) => {
    await renderer.act(async () => { field(placeholder).props.onChangeText(value); });
  };
  await renderer.act(async () => { tree = renderer.create(<DiaryNewScreen />); });
  await write(i18n.t('diary.steps.situation.placeholder'), 'Snow');
  await next();
  await write(i18n.t('diary.emotion.name'), 'Joy');
  await write('0–100', '101');
  await next();
  expect(visibleText()).toContain(i18n.t('diary.steps.emotions.title'));
  expect(field('0–100').props.value).toBe('101');
  await write('0–100', '37');
  await next(); // no Add tap required
  await next(); // reaction
  await write(i18n.t('diary.steps.thoughts.placeholder'), 'I will enjoy the snow');
  await next();
  await write('0–100', '100');
  await next();
  await write(i18n.t('diary.steps.meaning.placeholder'), 'A chance to feel joy');
  await next();
  expect(visibleText()).toContain('A chance to feel joy');
  await write(i18n.t('diary.steps.meaning.deeperPlaceholder'), 'Feeling carefree');
  const deepen = tree.root.findAllByType('Pressable').find((n: any) => textContent(n) === i18n.t('diary.meaning.deepen'));
  await renderer.act(async () => { deepen.props.onPress(); });
  await write(i18n.t('diary.steps.meaning.deeperPlaceholder'), 'I can rest');
  const back = tree.root.findAllByType('Pressable').find((n: any) => textContent(n) === i18n.t('diary.back'));
  await renderer.act(async () => { back.props.onPress(); });
  expect(field(i18n.t('diary.steps.meaning.deeperPlaceholder')).props.value).toBe('Feeling carefree');
  await next();
  expect(field(i18n.t('diary.steps.meaning.deeperPlaceholder')).props.value).toBe('I can rest');
  await next();
  await write(i18n.t('diary.steps.coreBelief.placeholder'), 'I can enjoy small things');
  await next(); // evidence
  await next(); // reframe
  await next(); // save
  const rows = await mockDb.select().from(schema.diaryEntries);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ thoughtBelief: 100, coreBelief: 'I can enjoy small things' });
  expect(JSON.parse(rows[0].emotions)).toEqual([{ name: 'Joy', intensity: 37 }]);
  expect(JSON.parse(rows[0].meanings)).toEqual(['A chance to feel joy', 'Feeling carefree', 'I can rest']);
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
