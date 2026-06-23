import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  bestBodyMindFromDb,
  bodyMindSignalsFromDb,
  gatherSignalMoodDays,
} from '@/lib/core/db/bodyMind';
import { saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { upsertSleep } from '@/lib/core/db/sleep';
import { upsertSteps } from '@/lib/core/db/steps';
import {
  associationInsight,
  bestAssociation,
  type AssociationResult,
  type SignalAssociation,
  type SignalMoodDay,
} from '@/lib/core/insights/bodyMind';

// ---- generic pure core ----------------------------------------------------

const pt = (signal: number, mood: number): SignalMoodDay => ({ day: `d${signal}-${mood}`, signal, mood });

describe('associationInsight (signal-agnostic core)', () => {
  it('reports a generic "more → better" link with the same guards as steps', () => {
    const points = [pt(1, 4), pt(2, 5), pt(3, 4), pt(8, 7), pt(9, 8), pt(10, 7)];
    expect(associationInsight(points)).toEqual({
      kind: 'link',
      pairedDays: 6,
      direction: 'more_better',
      moodGap: 3,
      fewerAvgMood: 4.3,
      moreAvgMood: 7.3,
    });
  });

  it('still says "insufficient" / "no_link" exactly like the original', () => {
    expect(associationInsight([pt(1, 4), pt(2, 5)])).toEqual({ kind: 'insufficient', pairedDays: 2 });
    expect(associationInsight([pt(5, 5), pt(5, 9), pt(5, 4), pt(5, 8), pt(5, 5), pt(5, 7)])).toEqual({
      kind: 'no_link',
      pairedDays: 6,
    });
  });
});

// ---- best-link selection --------------------------------------------------

const link = (gap: number, pairedDays = 6): AssociationResult => ({
  kind: 'link',
  pairedDays,
  direction: 'more_better',
  moodGap: gap,
  fewerAvgMood: 4,
  moreAvgMood: 4 + gap,
});

describe('bestAssociation', () => {
  it('returns null when there are no candidates', () => {
    expect(bestAssociation([])).toBeNull();
  });

  it('prefers the strongest real link by mood gap', () => {
    const cand: SignalAssociation[] = [
      { signal: 'steps', result: link(1.5) },
      { signal: 'sleep', result: link(3.2) },
      { signal: 'protein', result: { kind: 'no_link', pairedDays: 8 } },
    ];
    expect(bestAssociation(cand)?.signal).toBe('sleep');
  });

  it('breaks link ties by order (steps first), so the hero is stable', () => {
    const cand: SignalAssociation[] = [
      { signal: 'protein', result: link(2) },
      { signal: 'steps', result: link(2) },
    ];
    expect(bestAssociation(cand)?.signal).toBe('steps');
  });

  it('falls back to the most-data no_link when nothing links', () => {
    const cand: SignalAssociation[] = [
      { signal: 'steps', result: { kind: 'no_link', pairedDays: 7 } },
      { signal: 'sleep', result: { kind: 'no_link', pairedDays: 12 } },
      { signal: 'protein', result: { kind: 'insufficient', pairedDays: 3 } },
    ];
    const best = bestAssociation(cand);
    expect(best?.signal).toBe('sleep');
    expect(best?.result.kind).toBe('no_link');
  });

  it('falls back to the closest-to-surfacing insufficient when there is no link or no_link', () => {
    const cand: SignalAssociation[] = [
      { signal: 'steps', result: { kind: 'insufficient', pairedDays: 2 } },
      { signal: 'sleep', result: { kind: 'insufficient', pairedDays: 4 } },
    ];
    expect(bestAssociation(cand)?.signal).toBe('sleep');
  });
});

// ---- db gathering for sleep + protein -------------------------------------

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

function draft(mood: number | null): DiaryDraft {
  return {
    situation: '',
    thoughts: '',
    emotions: [],
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: '',
    mood,
  };
}

const noon = (d: number) => new Date(2026, 5, d, 12);

describe('gatherSignalMoodDays', () => {
  it('pairs sleep minutes with mood per local day, dropping unpaired days', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    await upsertSleep(db, '2026-06-01', 400);
    await upsertSleep(db, '2026-06-02', 460);
    await upsertSleep(db, '2026-06-03', 500); // no mood -> dropped
    await saveDiaryEntry(db, draft(5), noon(1));
    await saveDiaryEntry(db, draft(7), noon(2));

    const points = (await gatherSignalMoodDays(db, 'sleep')).sort((a, b) => a.day.localeCompare(b.day));
    expect(points).toEqual([
      { day: '2026-06-01', signal: 400, mood: 5 },
      { day: '2026-06-02', signal: 460, mood: 7 },
    ]);
    sqlite.close();
  });

  it('sums protein per day from the food log and pairs it with mood', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    // two meals on 06-01 → protein sums to 50
    await db.insert(schema.foodEntries).values([
      { ts: noon(1), rawText: 'a', source: 'text', kcal: 0, proteinG: 20, fatG: 0, carbG: 0, confirmed: true },
      { ts: noon(1), rawText: 'b', source: 'text', kcal: 0, proteinG: 30, fatG: 0, carbG: 0, confirmed: true },
      { ts: noon(2), rawText: 'c', source: 'text', kcal: 0, proteinG: 80, fatG: 0, carbG: 0, confirmed: true },
    ]);
    await saveDiaryEntry(db, draft(4), noon(1));
    await saveDiaryEntry(db, draft(8), noon(2));

    const points = (await gatherSignalMoodDays(db, 'protein')).sort((a, b) => a.day.localeCompare(b.day));
    expect(points).toEqual([
      { day: '2026-06-01', signal: 50, mood: 4 },
      { day: '2026-06-02', signal: 80, mood: 8 },
    ]);
    sqlite.close();
  });

  it('bestBodyMindFromDb surfaces the strongest honest signal across all three', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    // Build 6 paired days where sleep tracks mood strongly and steps are flat.
    const days: { d: number; steps: number; sleep: number; mood: number }[] = [
      { d: 1, steps: 5000, sleep: 360, mood: 3 },
      { d: 2, steps: 5000, sleep: 370, mood: 4 },
      { d: 3, steps: 5000, sleep: 380, mood: 3 },
      { d: 4, steps: 5000, sleep: 500, mood: 8 },
      { d: 5, steps: 5000, sleep: 510, mood: 9 },
      { d: 6, steps: 5000, sleep: 520, mood: 8 },
    ];
    for (const r of days) {
      await upsertSteps(db, `2026-06-0${r.d}`, r.steps);
      await upsertSleep(db, `2026-06-0${r.d}`, r.sleep);
      await saveDiaryEntry(db, draft(r.mood), noon(r.d));
    }

    const signals = await bodyMindSignalsFromDb(db);
    expect(signals).toHaveLength(3);

    const best = await bestBodyMindFromDb(db);
    expect(best?.signal).toBe('sleep');
    expect(best?.result.kind).toBe('link');
    sqlite.close();
  });
});
