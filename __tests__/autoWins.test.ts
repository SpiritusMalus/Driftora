import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import {
  AUTO_WIN_PROTEIN_GOAL,
  AUTO_WIN_STEPS_GOAL,
  awardOncePerDay,
  earnedAutoWinKinds,
  hasWinOfKindOnDay,
  runAutoWins,
  type AutoWinFacts,
} from '@/lib/core/db/autoWins';
import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { listWins } from '@/lib/core/db/settings';

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

const MESSAGES = { stepsGoal: 'steps win', proteinGoal: 'protein win' };

function facts(over: Partial<AutoWinFacts> = {}): AutoWinFacts {
  return { steps: 0, stepsGoal: 7000, proteinG: 0, proteinTargetG: 120, ...over };
}

describe('earnedAutoWinKinds', () => {
  it('awards the steps goal only when the count reaches the goal', () => {
    expect(earnedAutoWinKinds(facts({ steps: 6999 }))).not.toContain(AUTO_WIN_STEPS_GOAL);
    expect(earnedAutoWinKinds(facts({ steps: 7000 }))).toContain(AUTO_WIN_STEPS_GOAL);
    expect(earnedAutoWinKinds(facts({ steps: 12000 }))).toContain(AUTO_WIN_STEPS_GOAL);
  });

  it('awards the protein goal only when intake reaches the target', () => {
    expect(earnedAutoWinKinds(facts({ proteinG: 119 }))).not.toContain(AUTO_WIN_PROTEIN_GOAL);
    expect(earnedAutoWinKinds(facts({ proteinG: 120 }))).toContain(AUTO_WIN_PROTEIN_GOAL);
  });

  it('never awards when a goal/target is 0 (treated as "not set")', () => {
    expect(earnedAutoWinKinds(facts({ steps: 9000, stepsGoal: 0 }))).not.toContain(
      AUTO_WIN_STEPS_GOAL,
    );
    expect(earnedAutoWinKinds(facts({ proteinG: 200, proteinTargetG: 0 }))).not.toContain(
      AUTO_WIN_PROTEIN_GOAL,
    );
  });

  it('can earn both in one day', () => {
    expect(earnedAutoWinKinds(facts({ steps: 8000, proteinG: 130 }))).toEqual([
      AUTO_WIN_STEPS_GOAL,
      AUTO_WIN_PROTEIN_GOAL,
    ]);
  });

  it('awards nothing while on a break (paused)', () => {
    expect(earnedAutoWinKinds(facts({ steps: 8000, proteinG: 130, paused: true }))).toEqual([]);
  });
});

describe('awardOncePerDay', () => {
  it('writes once and then dedups within the same local day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const morning = new Date(2026, 5, 16, 9, 0);
    const evening = new Date(2026, 5, 16, 21, 30);

    expect(await hasWinOfKindOnDay(db, AUTO_WIN_STEPS_GOAL, morning)).toBe(false);
    expect(await awardOncePerDay(db, AUTO_WIN_STEPS_GOAL, 'steps win', morning)).toBe(true);
    expect(await hasWinOfKindOnDay(db, AUTO_WIN_STEPS_GOAL, evening)).toBe(true);
    // same day, second call -> no duplicate
    expect(await awardOncePerDay(db, AUTO_WIN_STEPS_GOAL, 'steps win', evening)).toBe(false);

    expect(await listWins(db)).toHaveLength(1);
    sqlite.close();
  });

  it('awards again on a new day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    expect(await awardOncePerDay(db, AUTO_WIN_STEPS_GOAL, 'd1', new Date(2026, 5, 16, 9))).toBe(
      true,
    );
    expect(await awardOncePerDay(db, AUTO_WIN_STEPS_GOAL, 'd2', new Date(2026, 5, 17, 9))).toBe(
      true,
    );
    expect(await listWins(db)).toHaveLength(2);
    sqlite.close();
  });

  it('dedups per kind — a different kind still gets its own win the same day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16, 12);

    expect(await awardOncePerDay(db, AUTO_WIN_STEPS_GOAL, 'steps', day)).toBe(true);
    expect(await awardOncePerDay(db, AUTO_WIN_PROTEIN_GOAL, 'protein', day)).toBe(true);
    expect(await listWins(db)).toHaveLength(2);
    sqlite.close();
  });
});

describe('runAutoWins', () => {
  it('writes earned wins with the supplied messages and reports the kinds', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16, 18);

    const awarded = await runAutoWins(db, facts({ steps: 8000, proteinG: 130 }), MESSAGES, day);
    expect(awarded).toEqual([AUTO_WIN_STEPS_GOAL, AUTO_WIN_PROTEIN_GOAL]);

    const stored = await listWins(db);
    expect(stored.map((w) => w.kind).sort()).toEqual(
      [AUTO_WIN_PROTEIN_GOAL, AUTO_WIN_STEPS_GOAL].sort(),
    );
    expect(stored.map((w) => w.message).sort()).toEqual(['protein win', 'steps win']);
    sqlite.close();
  });

  it('is idempotent across repeat focuses on the same day', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16, 18);

    const first = await runAutoWins(db, facts({ steps: 8000 }), MESSAGES, day);
    expect(first).toEqual([AUTO_WIN_STEPS_GOAL]);
    const second = await runAutoWins(db, facts({ steps: 9000 }), MESSAGES, day);
    expect(second).toEqual([]);
    expect(await listWins(db)).toHaveLength(1);
    sqlite.close();
  });

  it('awards nothing when no goal is reached', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));

    const awarded = await runAutoWins(db, facts({ steps: 3000, proteinG: 40 }), MESSAGES);
    expect(awarded).toEqual([]);
    expect(await listWins(db)).toHaveLength(0);
    sqlite.close();
  });

  it('leaves a manual win alone and does not dedup against it', async () => {
    const { sqlite, db } = makeDb();
    await applySchema((s) => sqlite.exec(s));
    const day = new Date(2026, 5, 16, 10);
    await db.insert(schema.wins).values({ kind: 'manual', message: 'felt good', ts: day });

    const awarded = await runAutoWins(db, facts({ steps: 8000 }), MESSAGES, day);
    expect(awarded).toEqual([AUTO_WIN_STEPS_GOAL]);
    expect(await listWins(db)).toHaveLength(2);
    sqlite.close();
  });
});
