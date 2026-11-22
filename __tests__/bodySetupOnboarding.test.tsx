import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import React from 'react';

import { consumeBodySetupRequest, Onboarding } from '@/components/Onboarding';

const renderer = require('react-test-renderer');
const mockDb = {};
let mockOnboardingSeen = false;
const mockEnsureSettings = jest.fn(async () => ({ onboardingSeen: mockOnboardingSeen }));
const mockUpdateSettings = jest.fn(async (_db: unknown, patch: { onboardingSeen: boolean }) => {
  mockOnboardingSeen = patch.onboardingSeen;
  return { onboardingSeen: mockOnboardingSeen };
});

jest.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/ui/PrimaryButton', () => ({ PrimaryButton: 'PrimaryButton' }));
jest.mock('@/lib/core/db/DatabaseProvider', () => ({ useDatabase: () => mockDb }));
jest.mock('@/lib/core/db/settings', () => ({
  ensureSettings: () => mockEnsureSettings(),
  updateSettings: (db: unknown, patch: { onboardingSeen: boolean }) => mockUpdateSettings(db, patch),
}));
jest.mock('@/lib/theme/theme', () => ({ useTheme: () => ({ font: {} }) }));

let tree: any;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mountIntro() {
  await renderer.act(async () => {
    tree = renderer.create(<Onboarding>{React.createElement('AppContent')}</Onboarding>);
  });
}

const appVisible = () => tree.root.findAllByType('AppContent').length === 1;

beforeEach(() => {
  consumeBodySetupRequest();
  mockOnboardingSeen = false;
  jest.clearAllMocks();
});

afterEach(async () => {
  if (tree) await renderer.act(async () => tree.unmount());
  tree = null;
});

it('mounts the app without requesting the wizard when the intro was already seen', async () => {
  mockOnboardingSeen = true;
  await mountIntro();

  expect(appVisible()).toBe(true);
  expect(consumeBodySetupRequest()).toBe(false);
  expect(mockUpdateSettings).not.toHaveBeenCalled();
});

it('requests the first wizard once, after saving the intro and before showing the app', async () => {
  let completeSave!: () => void;
  const save = new Promise<void>((resolve) => { completeSave = resolve; });
  mockUpdateSettings.mockImplementationOnce(async (_db, patch) => {
    await save;
    mockOnboardingSeen = patch.onboardingSeen;
    return { onboardingSeen: mockOnboardingSeen };
  });

  await mountIntro();
  await renderer.act(async () => tree.root.findByType('PrimaryButton').props.onPress());
  expect(tree.root.findByType('PrimaryButton').props.label).toBe('onboarding.start');
  await renderer.act(async () => tree.root.findByType('PrimaryButton').props.onPress());

  expect(mockUpdateSettings).toHaveBeenCalledWith(mockDb, { onboardingSeen: true });
  expect(appVisible()).toBe(false);
  expect(consumeBodySetupRequest()).toBe(false);
  await renderer.act(async () => completeSave());

  expect(appVisible()).toBe(true);
  expect(consumeBodySetupRequest()).toBe(true);
  expect(consumeBodySetupRequest()).toBe(false);

  await renderer.act(async () => tree.unmount());
  await mountIntro();
  expect(appVisible()).toBe(true);
  expect(consumeBodySetupRequest()).toBe(false);
  expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
});

it('requests the first wizard once when the intro slides are skipped', async () => {
  await mountIntro();
  await renderer.act(async () => tree.root.findByType('Pressable').props.onPress());

  expect(appVisible()).toBe(true);
  expect(consumeBodySetupRequest()).toBe(true);
  expect(consumeBodySetupRequest()).toBe(false);
});
