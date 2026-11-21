import { eq, inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { isFoodPhotoBase64 } from '../services/foodPhotoThumbnail';
import { foodEntries, foodEntryPhotos, type FoodEntry } from './schema';
import { withDbLock } from './tx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

export type FoodPhotoParentIdentity = Pick<FoodEntry,
  'ts' | 'source' | 'rawText' | 'kcal' | 'proteinG' | 'fatG' | 'carbG'>;

export function sameFoodPhotoParent(actual: FoodPhotoParentIdentity, expected: FoodPhotoParentIdentity): boolean {
  return Math.floor(actual.ts.getTime() / 1000) === Math.floor(expected.ts.getTime() / 1000) &&
    actual.source === expected.source && actual.rawText === expected.rawText &&
    actual.kcal === expected.kcal && actual.proteinG === expected.proteinG &&
    actual.fatG === expected.fatG && actual.carbG === expected.carbG;
}

/// Optional attachment: a photo failure must never roll back a saved meal.
/// Fail closed on unencrypted Expo Go/fallback builds. No URI, filesystem copy,
/// original metadata or remote request is retained; this table is local-only.
export async function saveFoodPhoto(
  db: AnyDb,
  entryId: number,
  base64: unknown,
  expectedParent?: FoodPhotoParentIdentity,
): Promise<boolean> {
  if (!Number.isSafeInteger(entryId) || entryId <= 0 || !isFoodPhotoBase64(base64)) return false;
  try {
    // Lazy require keeps native DB modules off normal list/backup import paths
    // and works with both Metro and the existing CommonJS Jest environment.
    const { getDbDriver } = require('./client') as typeof import('./client');
    if (getDbDriver() !== 'op-sqlite') return false;
    return await withDbLock(db, async () => {
      // Deletion/restore may have won while thumbnail preparation finished.
      // Check inside the shared queue, even when foreign_keys is disabled.
      const parent = await db.select().from(foodEntries).where(eq(foodEntries.id, entryId));
      if (parent.length === 0 || (expectedParent && !sameFoodPhotoParent(parent[0], expectedParent))) return false;
      await db.insert(foodEntryPhotos).values({ entryId, jpgBase64: base64 })
        .onConflictDoUpdate({ target: foodEntryPhotos.entryId, set: { jpgBase64: base64 } });
      return true;
    }, 'saveFoodPhoto');
  } catch {
    return false;
  }
}

/// Explicit current-day/visible-row load. Ordinary history, stats and exports
/// never materialize image data. Chunking stays below SQLite parameter limits.
export async function loadFoodPhotoUris(db: AnyDb, entryIds: readonly number[]): Promise<Record<number, string>> {
  const ids = [...new Set(entryIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  const photos: Record<number, string> = {};
  if (ids.length === 0) return photos;
  try {
    await withDbLock(db, async () => {
      for (let offset = 0; offset < ids.length; offset += 200) {
        const rows = await db.select().from(foodEntryPhotos)
          .where(inArray(foodEntryPhotos.entryId, ids.slice(offset, offset + 200)));
        for (const row of rows) {
          if (isFoodPhotoBase64(row.jpgBase64)) photos[row.entryId] = `data:image/jpeg;base64,${row.jpgBase64}`;
        }
      }
    }, 'loadFoodPhotoUris');
  } catch {
    // A missing/failed optional attachment degrades to the ordinary food icon.
  }
  return photos;
}

export async function getFoodPhotoUri(db: AnyDb, entryId: number): Promise<string | null> {
  return (await loadFoodPhotoUris(db, [entryId]))[entryId] ?? null;
}
