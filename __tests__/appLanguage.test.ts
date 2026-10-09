import { localizedWinMessage } from '@/lib/i18n/wins';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import i18n, { currentLocale, speechLocale } from '@/lib/i18n';
import { formatDecimal, formatInt } from '@/lib/core/format';
import { INIT_SQL, applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings, updateSettings } from '@/lib/core/db/settings';
import { exportAllTables, importAllTables } from '@/lib/core/db/backup';
import { legalDocText } from '@/lib/legal/documents';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';
import { HttpFoodParser } from '@/lib/core/services/httpFoodParser';
import { displayItemName, lookupNameForItem } from '@/lib/core/services/foodChoice';

const realFetch = globalThis.fetch;
afterEach(async () => { globalThis.fetch = realFetch; await i18n.changeLanguage('ru'); });

it('migrates an existing installation without changing its region or reminders', async () => {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  try {
    sqlite.exec(INIT_SQL.replace("  locale TEXT NOT NULL DEFAULT 'ru',\n", ''));
    sqlite.exec("INSERT INTO app_settings(id, region, reminder_times) VALUES (0, 'RU', '[\"09:00\"]')");
    await applySchema((s) => sqlite.exec(s));
    expect((await ensureSettings(db)).locale).toBe('ru');
    await updateSettings(db, { locale: 'en' });
    await applySchema((s) => sqlite.exec(s)); // next launch, idempotent migration
    const restored = await ensureSettings(drizzle(sqlite, { schema }));
    expect(restored.locale).toBe('en');
    expect(restored.region).toBe('RU');
    expect(restored.reminderTimes).toBe('["09:00"]');
  } finally { sqlite.close(); }
});

it('round-trips the language in backups and applies it after restoring', async () => {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  try {
    await applySchema((s) => sqlite.exec(s));
    await updateSettings(db, { locale: 'en', region: 'RU' });
    const backup = await exportAllTables(db);
    await updateSettings(db, { locale: 'ru' });
    await importAllTables(db, backup);
    expect(currentLocale()).toBe('en');
    expect((await ensureSettings(db)).region).toBe('RU');
    // A backup created before this feature must continue to restore.
    delete backup.tables.app_settings[0].locale;
    await importAllTables(db, backup);
    expect(currentLocale()).toBe('ru');
  } finally { sqlite.close(); }
});

it('switches formats, speech and legal readers with the explicit UI language', async () => {
  expect(formatDecimal(72.5)).toBe('72,5');
  expect(speechLocale()).toBe('ru-RU');
  await i18n.changeLanguage('en');
  expect(formatDecimal(72.5)).toBe('72.5');
  expect(formatInt(8400)).toBe('8,400');
  expect(speechLocale()).toBe('en-US');
  for (const doc of ['terms', 'privacy'] as const) {
    const text = legalDocText(doc);
    expect(text).not.toMatch(/[А-Яа-яЁё]/);
    expect(text).toContain('326508100294665');
    expect(text).toContain('504414138460');
    expect(text).toContain('August 13, 2026');
    expect(text).toContain('support@family-pie.ru');
  }
});

it('handles English offline input while keeping Russian lookup keys for the RU database', async () => {
  const draft = await new StubFoodParser().parse('two eggs and coffee', 'RU');
  expect(draft.items).toHaveLength(2);
  expect(draft.items[0].grams).toBe(100);
  expect(displayItemName(draft.items[0], 'RU', 'en')).toBe('egg ×2');
  expect(lookupNameForItem(draft.items[0], 'RU')).toBe('Яйцо ×2');
});

it('sends the current language per request, independently of the nutrition region', async () => {
  const calls: RequestInit[] = [];
  globalThis.fetch = jest.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(init!);
    return { ok: true, json: async () => ({ candidates: [] }) } as Response;
  }) as typeof fetch;
  const parser = new HttpFoodParser('https://example.test/food/parse', new StubFoodParser());
  await i18n.changeLanguage('en');
  await parser.searchFoods('egg', 'RU');
  await i18n.changeLanguage('ru');
  await parser.searchFoods('яйцо', 'RU');
  expect((calls[0].headers as Record<string, string>)['Accept-Language']).toBe('en');
  expect((calls[1].headers as Record<string, string>)['Accept-Language']).toBe('ru');
  expect(JSON.parse(calls[0].body as string).region).toBe('RU');
});

it('localizes old automatic celebrations while preserving the user’s own words', async () => {
  await i18n.changeLanguage('en');
  const t = (key: string) => i18n.t(key);
  expect(localizedWinMessage({ kind: 'auto:workout', message: 'Сегодня тренировка' }, t)).toBe('You worked out today.');
  expect(localizedWinMessage({ kind: 'manual', message: 'Моя маленькая победа' }, t)).toBe('Моя маленькая победа');
});
