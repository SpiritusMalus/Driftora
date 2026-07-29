import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { listDiaryEntries, saveDiaryEntry, type DiaryDraft } from '@/lib/core/db/diary';
import { listEntriesForDay, saveParsedEntry, todayMacroTotals } from '@/lib/core/db/food';
import { applySchema } from '@/lib/core/db/init';
import { listMoods, logMood } from '@/lib/core/db/mood';
import * as schema from '@/lib/core/db/schema';
import { addWin, listWins } from '@/lib/core/db/settings';
import { getStepsForDay, upsertSteps } from '@/lib/core/db/steps';
import { withDbLock, withTx } from '@/lib/core/db/tx';
import { addWorkout, listWorkoutsForDay } from '@/lib/core/db/workouts';
import type { MealDraft } from '@/lib/core/services/foodParser';
import { withItemManualMacros } from '@/lib/core/services/mealDraft';
import { StubFoodParser } from '@/lib/core/services/stubFoodParser';

/// ——— Reproducing a device-only bug in a synchronous test driver ———
///
/// better-sqlite3 (tests) and expo-sqlite run `run` synchronously, so two
/// helpers can never actually interleave there — which is why the shared
/// connection's overlapping `BEGIN`s went unnoticed for so long. op-sqlite (the
/// real device driver) resolves `run` asynchronously, so a second helper gets to
/// issue its own `BEGIN` while the first transaction is open, SQLite refuses it,
/// and that helper's rows are silently lost.
///
/// This proxy is the smallest faithful stand-in: real SQLite, real transaction
/// semantics, but `run` yields a macrotask first — exactly the window op-sqlite
/// leaves open. Everything else on the handle is untouched.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withAsyncRun<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'run') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async (query: any) => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (target as any).run(query);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

function makeDb() {
  const sqlite = new BetterSqlite3(':memory:');
  const db = drizzle(sqlite, { schema });
  return { sqlite, db, asyncDb: withAsyncRun(db) };
}

type AnyDrizzle = ReturnType<typeof makeDb>['db'];

function fillMacros(draft: MealDraft): MealDraft {
  let d = draft;
  for (let i = 0; i < d.items.length; i++) {
    d = withItemManualMacros(d, i, { kcal: 120, prot: 10, fat: 5, carb: 8 });
  }
  return d;
}

describe('database transaction queue', () => {
  it('keeps both meals when two saves overlap on an async driver', async () => {
    const { sqlite, db, asyncDb } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const parser = new StubFoodParser();
    const first = fillMacros(await parser.parse('омлет из трёх яиц', 'RU'));
    const second = fillMacros(await parser.parse('банан', 'RU'));

    // The real shape of the bug: the user confirms a meal while the background
    // photo parse lands. Before the queue, the second BEGIN threw «cannot start
    // a transaction within a transaction» and that meal was simply gone — the
    // day showed 420 kcal instead of 1030 and the photo «didn't recognise».
    await Promise.all([
      saveParsedEntry(asyncDb, { rawText: 'омлет из трёх яиц', source: 'text', draft: first }),
      saveParsedEntry(asyncDb, { rawText: 'банан', source: 'photo', draft: second }),
    ]);

    const entries = await listEntriesForDay(db);
    expect(entries).toHaveLength(2);
    const totals = await todayMacroTotals(db);
    expect(totals.kcal).toBeCloseTo(first.totals.kcal + second.totals.kcal, 1);

    sqlite.close();
  });

  it('does not let a rolled-back transaction take a neighbouring write with it', async () => {
    const { sqlite, db, asyncDb } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    // A health write issued while a food transaction is open used to be ADOPTED
    // by that transaction — no error anywhere, but the steps vanished the moment
    // the food helper rolled back.
    //
    // The gate makes that window deterministic instead of timing-dependent: the
    // transaction is provably open and mid-body when the steps write is issued,
    // which is the only arrangement that actually distinguishes queued from not.
    let openTransaction: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      openTransaction = resolve;
    });

    const doomed = withTx(asyncDb, async () => {
      await db.insert(schema.foodEntries).values({
        ts: new Date(),
        rawText: 'обед',
        source: 'text',
        kcal: 600,
        proteinG: 30,
        fatG: 20,
        carbG: 60,
        confirmed: true,
      });
      await held;
      throw new Error('parse failed after the entry row');
    });

    // Let BEGIN and the entry insert actually execute.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const steps = upsertSteps(asyncDb, new Date(), 8421, 'device');
    openTransaction?.();

    await expect(doomed).rejects.toThrow('parse failed');
    await steps;

    expect(await getStepsForDay(db, new Date())).toBe(8421);
    // The food row is gone (its own transaction rolled back) — that part is correct.
    expect(await listEntriesForDay(db)).toHaveLength(0);

    sqlite.close();
  });

  // The fix above was applied to the health writes and to nothing else, so the
  // same rollback quietly ate a mood check-in, a thought record and a workout
  // for as long as those helpers wrote straight to the connection. One case per
  // module that owns a bare user-facing write: if a new helper skips the queue,
  // it belongs here too.
  it.each([
    [
      'настроение',
      (db: AnyDrizzle) => logMood(db, 4),
      async (db: AnyDrizzle) => (await listMoods(db)).length,
    ],
    [
      'запись дневника',
      (db: AnyDrizzle) => saveDiaryEntry(db, { mood: 3, distortions: [] } as unknown as DiaryDraft),
      async (db: AnyDrizzle) => (await listDiaryEntries(db)).length,
    ],
    [
      'тренировка',
      (db: AnyDrizzle) => addWorkout(db, 'walk', 30, 80),
      async (db: AnyDrizzle) => (await listWorkoutsForDay(db, new Date())).length,
    ],
    [
      'победа',
      (db: AnyDrizzle) => addWin(db, 'manual', 'проверка'),
      async (db: AnyDrizzle) => (await listWins(db)).length,
    ],
  ])('%s survives a neighbouring rollback', async (_name, write, countRows) => {
    const { sqlite, db, asyncDb } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    let openTransaction: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      openTransaction = resolve;
    });
    const doomed = withTx(asyncDb, async () => {
      await db.insert(schema.foodEntries).values({
        ts: new Date(),
        rawText: 'обед',
        source: 'text',
        kcal: 600,
        proteinG: 30,
        fatG: 20,
        carbG: 60,
        confirmed: true,
      });
      await held;
      throw new Error('parse failed after the entry row');
    });

    // Let BEGIN and the entry insert actually execute.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const neighbour = write(asyncDb);
    openTransaction?.();

    await expect(doomed).rejects.toThrow('parse failed');
    await neighbour;

    expect(await countRows(db)).toBe(1);
    sqlite.close();
  });

  it('keeps draining after a failed transaction', async () => {
    const { sqlite, db, asyncDb } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const failed = withTx(asyncDb, async () => {
      throw new Error('boom');
    });
    // Queued behind the failure. NOT wrapped in another withDbLock — upsertSteps
    // already takes the queue itself, and nesting is the one thing this queue
    // can't survive (it would wait for the outer call that waits for it).
    const after = upsertSteps(asyncDb, '2026-07-01', 5000, 'manual');

    await expect(failed).rejects.toThrow('boom');
    await after;

    expect(await getStepsForDay(db, new Date(2026, 6, 1))).toBe(5000);

    sqlite.close();
  });

  it('runs queued work in call order', async () => {
    const { sqlite, asyncDb } = makeDb();
    await applySchema((stmt) => sqlite.exec(stmt));

    const order: string[] = [];
    await Promise.all([
      withDbLock(asyncDb, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('first');
      }),
      withDbLock(asyncDb, async () => {
        order.push('second');
      }),
    ]);

    expect(order).toEqual(['first', 'second']);

    sqlite.close();
  });
});
