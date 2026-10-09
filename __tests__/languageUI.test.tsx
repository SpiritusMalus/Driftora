import React from 'react';
import { afterEach, expect, it, jest } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import i18n from '@/lib/i18n';

const renderer = require('react-test-renderer');
let mockDb: ReturnType<typeof drizzle>;
const mockSchedule = jest.fn(async (_spec: unknown) => {});
const mockCancel = jest.fn(async () => {});
jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() }, Linking: { openURL: jest.fn(), openSettings: jest.fn() },
  Pressable: 'Pressable', Text: 'Text', View: 'View', Switch: 'Switch',
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
}));
jest.mock('@react-navigation/native', () => ({ usePreventRemove: () => {} }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }), useNavigation: () => ({ dispatch: jest.fn() }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('@/lib/core/db/client', () => ({ getDbDriver: () => 'op-sqlite' }));
jest.mock('@/lib/core/db/DatabaseProvider', () => ({ useDatabase: () => mockDb }));
jest.mock('@/lib/core/services/notificationProvider', () => ({ getNotificationService: () => ({
  initialize: async () => {}, requestPermissions: async () => true,
  cancelAll: mockCancel, scheduleDaily: mockSchedule,
}) }));
jest.mock('@/lib/theme/theme', () => ({ useTheme: () => ({ scheme: 'light', font: {}, }) }));
jest.mock('@/components/consent/ConsentModal', () => ({ ConsentModal: 'ConsentModal' }));
jest.mock('@/components/legal/LegalReader', () => ({ LegalReader: 'LegalReader' }));
jest.mock('@/components/ui/Card', () => ({ Card: 'Card' }));
jest.mock('@/components/ui/Chip', () => ({ Chip: 'Chip', ChipRow: 'ChipRow' }));
jest.mock('@/components/ui/ListGroup', () => ({ ListGroup: 'ListGroup' }));
jest.mock('@/components/ui/PrimaryButton', () => ({ PrimaryButton: 'PrimaryButton' }));
jest.mock('@/components/ui/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/components/ui/SectionHeader', () => ({ SectionHeader: 'SectionHeader' }));
jest.mock('@/components/ui/TextField', () => ({ TextField: 'TextField' }));

const SettingsScreen = require('@/app/settings/index').default;
let tree: any;
let sqlite: BetterSqlite3.Database;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (tree) await renderer.act(async () => tree.unmount());
  sqlite?.close();
  await i18n.changeLanguage('ru');
  jest.clearAllMocks();
});

it('the actual Settings action persists English, rerenders copy, and refreshes saved notifications', async () => {
  sqlite = new BetterSqlite3(':memory:');
  mockDb = drizzle(sqlite, { schema });
  await applySchema((s) => sqlite.exec(s));
  await updateSettings(mockDb, { region: 'RU', reminderTimes: ['09:00'] });
  await renderer.act(async () => { tree = renderer.create(<SettingsScreen />); });
  const english = tree.root.findAllByType('Chip').find((n: any) => n.props.label === 'English');
  expect(english.props.disabled).toBe(false);
  await renderer.act(async () => { await english.props.onPress(); });
  // The screen’s handler launches a promise; let its database queue finish.
  await renderer.act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect((await ensureSettings(mockDb)).locale).toBe('en');
  expect((await ensureSettings(mockDb)).region).toBe('RU');
  expect(tree.root.findAllByType('Chip').find((n: any) => n.props.label === 'English').props.selected).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('Language');
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ hour: 9,
    title: i18n.t('notifications.reminderTitle'), body: i18n.t('notifications.reminderBody') }));
  const russian = tree.root.findAllByType('Chip').find((n: any) => n.props.label === 'Русский');
  await renderer.act(async () => { russian.props.onPress(); await new Promise((r) => setTimeout(r, 20)); });
  expect((await ensureSettings(mockDb)).locale).toBe('ru');
});
