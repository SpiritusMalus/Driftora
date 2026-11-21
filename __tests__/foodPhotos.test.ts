import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let mockDriver = 'op-sqlite';
jest.mock('@/lib/core/db/client', () => ({ getDbDriver: () => mockDriver }));
jest.mock('@/lib/core/services/tempFiles', () => ({ deleteTempFile: jest.fn() }));

import { exportAllTables, importAllTables } from '@/lib/core/db/backup';
import { deleteFoodEntry, getFoodEntry, listEntriesForDay, saveParsedEntry, savePendingEntry } from '@/lib/core/db/food';
import { getFoodPhotoUri, loadFoodPhotoUris, saveFoodPhoto } from '@/lib/core/db/foodPhotos';
import { applySchema } from '@/lib/core/db/init';
import { ensureSettings } from '@/lib/core/db/settings';
import * as schema from '@/lib/core/db/schema';
import { runAdoptedParse } from '@/lib/core/services/backgroundParses';
import { MAX_FOOD_PHOTO_BASE64_LENGTH } from '@/lib/core/services/foodPhotoThumbnail';
import type { MealDraft } from '@/lib/core/services/foodParser';
import { recomputeDraft, scaleToGrams } from '@/lib/core/services/mealDraft';

// Tiny distinct JPEG-shaped byte fixtures; no sample/user photos in the bundle.
const firstPhoto = Buffer.from([255, 216, 255, 224, 0, 2, 1, 255, 217]).toString('base64');
const secondPhoto = Buffer.from([255, 216, 255, 224, 0, 2, 2, 255, 217]).toString('base64');
const uri = (b64: string) => `data:image/jpeg;base64,${b64}`;
const temporary: string[] = [];
beforeEach(() => { mockDriver = 'op-sqlite'; });
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

function makeDb(file = ':memory:') {
  const sqlite = new BetterSqlite3(file);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(): MealDraft {
  const per100 = { source: 'manual' as const, kcal: 120, prot: 10, fat: 4, carb: 11, minerals: {} };
  return recomputeDraft('RU', [{
    name_ru: 'Обед', name_en: 'Lunch', grams: 200, grams_source: 'confirmed',
    confidence: 1, per100, scaled: scaleToGrams(per100, 200), approximate: false,
  }]);
}

async function save(db: ReturnType<typeof makeDb>['db'], photoBase64?: string) {
  return saveParsedEntry(db, { rawText: 'Обед', source: 'photo', draft: draft(), photoBase64 });
}

describe('device-only saved meal thumbnails', () => {
  it('associates each saved meal with its own photo and survives reopening the database', async () => {
    expect(require('@/lib/core/db/client').getDbDriver()).toBe('op-sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'driftora-photo-test-')); temporary.push(dir);
    const file = join(dir, 'test.db');
    const first = makeDb(file);
    await applySchema((s) => first.sqlite.exec(s));
    const a = await save(first.db, firstPhoto);
    const b = await save(first.db, secondPhoto);
    const noPhoto = await save(first.db);
    expect(await loadFoodPhotoUris(first.db, [a, a, noPhoto])).toEqual({ [a]: uri(firstPhoto) });
    expect(await getFoodPhotoUri(first.db, b)).toBe(uri(secondPhoto));
    // Existing stats/list/detail payloads do not implicitly fetch or export pixels.
    expect(JSON.stringify(await listEntriesForDay(first.db))).not.toContain(firstPhoto);
    expect((await getFoodEntry(first.db, a))!.entry.kcal).toBe(240);
    first.sqlite.close();
    const restarted = makeDb(file);
    await applySchema((s) => restarted.sqlite.exec(s));
    expect(await loadFoodPhotoUris(restarted.db, [a, b, noPhoto])).toEqual({ [a]: uri(firstPhoto), [b]: uri(secondPhoto) });
    restarted.sqlite.close();
  });

  it('does not retain pixels on unencrypted builds or accept URLs, oversized data or orphan attachments', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    const id = await save(db);
    mockDriver = 'expo-sqlite';
    expect(await saveFoodPhoto(db, id, firstPhoto)).toBe(false);
    mockDriver = 'op-sqlite';
    expect(await saveFoodPhoto(db, id, 'https://example.invalid/stock.jpg')).toBe(false);
    expect(await saveFoodPhoto(db, id, '/9j/' + 'A'.repeat(MAX_FOOD_PHOTO_BASE64_LENGTH))).toBe(false);
    expect(await saveFoodPhoto(db, id + 500, firstPhoto)).toBe(false);
    const parent = (await getFoodEntry(db, id))!.entry;
    expect(await saveFoodPhoto(db, id, firstPhoto, { ...parent, rawText: 'A replaced meal' })).toBe(false);
    expect(await loadFoodPhotoUris(db, [id, id + 500, -1, NaN])).toEqual({});
    expect(sqlite.prepare('SELECT * FROM food_entry_photos').all()).toEqual([]);
    sqlite.close();
  });

  it.each([false, true])('deletes pixels with their entry (foreign_keys enabled: %s)', async (foreignKeys) => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    const id = await save(db, firstPhoto);
    expect(await getFoodPhotoUri(db, id)).toBe(uri(firstPhoto));
    await deleteFoodEntry(db, id);
    expect(await getFoodPhotoUri(db, id)).toBeNull();
    expect(sqlite.prepare('SELECT * FROM food_entry_photos').all()).toEqual([]);
    sqlite.close();
  });

  it('omits all photo bytes from backup/sync documents and erases local attachments on restore even for reused ids', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    sqlite.pragma('foreign_keys = OFF');
    const id = await save(db, firstPhoto);
    const backup = await exportAllTables(db);
    expect(JSON.stringify(backup)).not.toContain(firstPhoto);
    expect(Object.keys(backup.tables)).not.toContain('food_entry_photos');
    // Unknown tables in a file cannot smuggle photos into the restore path.
    Object.assign(backup.tables, { food_entry_photos: [{ entry_id: id, jpg_base64: secondPhoto }] });
    await importAllTables(db, backup);
    expect(await getFoodEntry(db, id)).not.toBeNull();
    expect(await getFoodPhotoUri(db, id)).toBeNull();
    expect(sqlite.prepare('SELECT * FROM food_entry_photos').all()).toEqual([]);
    sqlite.close();
  });

  it('keeps saved nutrition when optional photo storage fails', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    sqlite.exec("CREATE TRIGGER photo_write_failure BEFORE INSERT ON food_entry_photos BEGIN SELECT RAISE(FAIL, 'simulated photo failure'); END");
    const id = await save(db, firstPhoto);
    expect((await getFoodEntry(db, id))!.entry.kcal).toBe(240);
    expect((await getFoodEntry(db, id))!.items).toHaveLength(1);
    expect(await getFoodPhotoUri(db, id)).toBeNull();
    sqlite.close();
  });

  it('preserves exact unchanged local meals on routine sync without exporting pixels, and rejects an id reused for another meal', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    sqlite.pragma('foreign_keys = ON');
    const a = await save(db, firstPhoto);
    const b = await save(db, secondPhoto);
    await ensureSettings(db);
    const backup = await exportAllTables(db);
    await importAllTables(db, backup, { preserveUnchangedLocalFoodPhotos: true });
    expect(await loadFoodPhotoUris(db, [a, b])).toEqual({ [a]: uri(firstPhoto), [b]: uri(secondPhoto) });
    expect((await exportAllTables(db)).tables).toEqual(backup.tables);
    const replacement = JSON.parse(JSON.stringify(backup)) as typeof backup;
    replacement.tables.food_entries.find((row) => row.id === b)!.raw_text = 'Different meal on another device';
    await importAllTables(db, replacement, { preserveUnchangedLocalFoodPhotos: true });
    expect(await getFoodPhotoUri(db, a)).toBe(uri(firstPhoto));
    expect(await getFoodPhotoUri(db, b)).toBeNull();
    expect((await getFoodEntry(db, b))!.entry.rawText).toBe('Different meal on another device');
    expect((await exportAllTables(db)).tables).toEqual(replacement.tables);
    sqlite.close();
  });

  it('rolls back local photo deletion if a manual restore fails', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    const id = await save(db, firstPhoto);
    const broken = await exportAllTables(db);
    broken.tables.food_items[0].nonexistent_column = 1;
    await expect(importAllTables(db, broken)).rejects.toThrow();
    expect(await getFoodPhotoUri(db, id)).toBe(uri(firstPhoto));
    expect((await getFoodEntry(db, id))!.entry.kcal).toBe(240);
    sqlite.close();
  });

  it('attaches each adopted parse photo to its own saved entry; failed or deleted attempts leave no pixels', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    const a = await savePendingEntry(db, { source: 'photo' });
    const b = await savePendingEntry(db, { source: 'photo' });
    const failed = await savePendingEntry(db, { source: 'photo' });
    const deleted = await savePendingEntry(db, { source: 'photo' });
    await deleteFoodEntry(db, deleted);
    const photo = (base64: string) => ({ uri: `file:///private-cache/${base64.length}.jpg`, mimeType: 'image/jpeg', localThumbnailBase64: base64 });
    await runAdoptedParse(db, a, Promise.resolve(draft()), { region: 'RU', photo: photo(firstPhoto) });
    await runAdoptedParse(db, b, Promise.resolve(draft()), { region: 'RU', photo: photo(secondPhoto) });
    await runAdoptedParse(db, failed, Promise.resolve(recomputeDraft('RU', [])), { region: 'RU', photo: photo(firstPhoto) });
    await runAdoptedParse(db, deleted, Promise.resolve(draft()), { region: 'RU', photo: photo(firstPhoto) });
    expect(await loadFoodPhotoUris(db, [a, b, failed, deleted])).toEqual({ [a]: uri(firstPhoto), [b]: uri(secondPhoto) });
    expect((await getFoodEntry(db, a))!.entry.confirmed).toBe(false);
    expect((await getFoodEntry(db, failed))!.entry.parseStatus).toBe('failed');
    expect(sqlite.prepare('SELECT * FROM food_items WHERE entry_id = ?').all(deleted)).toEqual([]);
    sqlite.close();
  });

  it('a late adopted parse cannot replace or attach its old photo to an id reused by a manual restore', async () => {
    const { sqlite, db } = makeDb(); await applySchema((s) => sqlite.exec(s));
    const id = await savePendingEntry(db, { source: 'photo' });
    let resolve!: (meal: MealDraft) => void;
    const deferred = new Promise<MealDraft>((done) => { resolve = done; });
    const running = runAdoptedParse(db, id, deferred, {
      region: 'RU', photo: { uri: 'file:///private-cache/old.jpg', mimeType: 'image/jpeg', localThumbnailBase64: firstPhoto },
    });
    await new Promise<void>((done) => setImmediate(done));
    const replacement = await exportAllTables(db);
    const row = replacement.tables.food_entries.find((entry) => entry.id === id)!;
    row.raw_text = 'Restored different meal'; row.source = 'text'; row.kcal = 300;
    row.parse_status = null; row.confirmed = 1;
    await importAllTables(db, replacement);
    resolve(draft()); await running;
    expect((await getFoodEntry(db, id))!.entry).toMatchObject({ rawText: 'Restored different meal', kcal: 300, source: 'text' });
    expect(await getFoodPhotoUri(db, id)).toBeNull();
    sqlite.close();
  });
});
