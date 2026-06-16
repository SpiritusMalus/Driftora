import { count, desc, eq, gte } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import { isDistortionKey, type DistortionKey } from '../insights/distortions';
import { diaryEntries, type DiaryEntry } from './schema';

/// Accepts any drizzle SQLite database (op-sqlite async on device,
/// better-sqlite3 sync in tests). Query builders are awaitable for both.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// A named feeling with its intensity (0–100), as captured in a thought record.
export interface Emotion {
  name: string;
  intensity: number;
}

/// The fields a user fills in for one СМЭР (CBT) thought record.
export interface DiaryDraft {
  situation: string;
  thoughts: string;
  emotions: Emotion[];
  reactionBody: string;
  reactionBehavior: string;
  evidenceFor: string;
  evidenceAgainst: string;
  reframe: string;
  mood: number | null; // 0–10, optional
  distortions?: DistortionKey[]; // tagged cognitive distortions (optional)
}

/// A stored entry with `emotions` and `distortions` parsed from their JSON columns.
export type DiaryEntryView = Omit<DiaryEntry, 'emotions' | 'distortions'> & {
  emotions: Emotion[];
  distortions: DistortionKey[];
};

function parseDistortions(json: string): DistortionKey[] {
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value.filter((x): x is DistortionKey => typeof x === 'string' && isDistortionKey(x));
  } catch {
    return [];
  }
}

function parseEmotions(json: string): Emotion[] {
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (e) => e && typeof e.name === 'string' && typeof e.intensity === 'number',
      )
      .map((e) => ({ name: e.name as string, intensity: e.intensity as number }));
  } catch {
    return [];
  }
}

function toView(row: DiaryEntry): DiaryEntryView {
  const { emotions, distortions, ...rest } = row;
  return {
    ...rest,
    emotions: parseEmotions(emotions),
    distortions: parseDistortions(distortions),
  };
}

/// Saves a thought record. Returns the new entry id.
export async function saveDiaryEntry(
  db: AnyDb,
  draft: DiaryDraft,
  ts: Date = new Date(),
): Promise<number> {
  const inserted = await db
    .insert(diaryEntries)
    .values({
      ts,
      situation: draft.situation,
      thoughts: draft.thoughts,
      emotions: JSON.stringify(draft.emotions ?? []),
      reactionBody: draft.reactionBody,
      reactionBehavior: draft.reactionBehavior,
      evidenceFor: draft.evidenceFor,
      evidenceAgainst: draft.evidenceAgainst,
      reframe: draft.reframe,
      mood: draft.mood,
      distortions: JSON.stringify(draft.distortions ?? []),
    })
    .returning({ id: diaryEntries.id });
  return inserted[0].id as number;
}

/// Distortion tag lists from entries since [since] — the input to
/// `thinkingTrapOfWeek`.
export async function listDistortionTagsSince(
  db: AnyDb,
  since: Date,
): Promise<DistortionKey[][]> {
  const rows = (await db
    .select({ distortions: diaryEntries.distortions })
    .from(diaryEntries)
    .where(gte(diaryEntries.ts, since))) as { distortions: string }[];
  return rows.map((r) => parseDistortions(r.distortions));
}

/// Entries newest-first, optionally capped to [limit].
export async function listDiaryEntries(
  db: AnyDb,
  limit?: number,
): Promise<DiaryEntryView[]> {
  const query = db.select().from(diaryEntries).orderBy(desc(diaryEntries.ts));
  const rows = (await (limit != null ? query.limit(limit) : query)) as DiaryEntry[];
  return rows.map(toView);
}

/// A single entry by id, or null if it doesn't exist.
export async function getDiaryEntry(
  db: AnyDb,
  id: number,
): Promise<DiaryEntryView | null> {
  const rows = (await db
    .select()
    .from(diaryEntries)
    .where(eq(diaryEntries.id, id))) as DiaryEntry[];
  return rows.length > 0 ? toView(rows[0]) : null;
}

/// How many thought records exist.
export async function countDiaryEntries(db: AnyDb): Promise<number> {
  const rows = await db.select({ c: count() }).from(diaryEntries);
  return Number(rows[0]?.c ?? 0);
}
