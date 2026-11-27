import { desc, eq, notInArray } from 'drizzle-orm';
import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';

import { foodPhotoAnalyses } from '../db/schema';
import { withTx } from '../db/tx';
import type { PhotoAnalysisCache } from './httpFoodParser';

const MAX_PHOTO_ANALYSES = 256;

/** Keep the resolved draft in the local DB, independent of edits and the diary. */
export const photoAnalysisCache: PhotoAnalysisCache = {
  async key(photo, region, locale) {
    const bytes = await new File(photo.uri).bytes();
    const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes));
    const fingerprint = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `v1:${region}:${locale}:${fingerprint}`;
  },

  async get(key) {
    const { openDatabase } = await import('../db/client');
    const db = await openDatabase();
    const row = await db.select({ draft: foodPhotoAnalyses.draft })
      .from(foodPhotoAnalyses).where(eq(foodPhotoAnalyses.key, key)).get();
    return row ? JSON.parse(row.draft) as unknown : undefined;
  },

  async put(key, draft) {
    const { openDatabase } = await import('../db/client');
    const db = await openDatabase();
    const record = { key, draft: JSON.stringify(draft), storedAt: Date.now() };
    await withTx(db, async () => {
      await db.insert(foodPhotoAnalyses).values(record).onConflictDoUpdate({
        target: foodPhotoAnalyses.key,
        set: { draft: record.draft, storedAt: record.storedAt },
      });
      const recent = db.select({ key: foodPhotoAnalyses.key }).from(foodPhotoAnalyses)
        .orderBy(desc(foodPhotoAnalyses.storedAt), foodPhotoAnalyses.key).limit(MAX_PHOTO_ANALYSES);
      await db.delete(foodPhotoAnalyses).where(notInArray(foodPhotoAnalyses.key, recent));
    }, 'rememberPhotoAnalysis');
  },
};
