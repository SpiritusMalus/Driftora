import { sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// ——— Why this module exists ———
///
/// Every db helper shares ONE connection. Raw `BEGIN`/`COMMIT` on a shared
/// connection is only safe while nothing else touches it, and on device nothing
/// guarantees that: the async photo parse lands (`applyDraftToPendingEntry`)
/// while the user is saving a meal, a health import runs while an edit is open.
///
/// Two failure modes follow, and BOTH are silent — the write is simply gone:
///
///   1. Overlapping transactions. On op-sqlite (`run` is genuinely async) the
///      second `BEGIN` hits "cannot start a transaction within a transaction",
///      that helper throws, and its rows never land. The user sees a day of
///      420 kcal instead of 1030 and a photo that "didn't recognise".
///   2. A stray write adopted by someone else's transaction. A single-statement
///      health/steps write issued while a food transaction is open is NOT
///      autocommitted — it joins that transaction, and a rollback takes it too.
///
/// Tests never reproduce either one: better-sqlite3 and expo-sqlite run `run`
/// synchronously, so no two transactions can interleave there no matter how the
/// callers are written. The device is the only place this bug exists, which is
/// exactly why it has to be fixed structurally rather than test-first.
///
/// The fix is a per-database FIFO queue. Transactions are serialized against
/// each other, and any write batch that must not be adopted by a neighbouring
/// transaction runs through the same queue. We do not use drizzle's
/// `transaction()` (not wired for every driver this app runs on) nor op-sqlite's
/// own lock directly (the raw handle isn't exposed past `openDatabase`), and a
/// queue works identically on all three drivers, tests included.

/// The tail of each database's work queue. Keyed by the db handle so parallel
/// test databases never share a lock, and so nothing leaks when one is dropped.
const queues = new WeakMap<object, Promise<unknown>>();

/// A task waiting this long has almost certainly hit the one rule this queue
/// can't enforce by types: `withTx`/`withDbLock` must never be called from
/// INSIDE another one on the same db — the inner call waits for the outer to
/// finish, which waits for the inner. A plain mutex would just hang forever;
/// this at least says why, and points at the two frames involved.
const STUCK_WARN_MS = 10_000;

function enqueue<T>(db: AnyDb, task: () => Promise<T>, label: string): Promise<T> {
  const previous = queues.get(db) ?? Promise.resolve();

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timer = undefined;
    console.warn(
      `[db] ${label} has been waiting ${STUCK_WARN_MS / 1000}s for the database queue. ` +
        'A nested withTx/withDbLock on the same database deadlocks — the inner call ' +
        'must take the outer transaction instead of opening its own.',
    );
  }, STUCK_WARN_MS);

  const started = previous.then(
    () => {
      if (timer !== undefined) clearTimeout(timer);
      return task();
    },
    () => {
      // The previous task's failure is its caller's business, not ours: the
      // queue must keep draining or every later write dies with it.
      if (timer !== undefined) clearTimeout(timer);
      return task();
    },
  );

  // Park a swallowed copy as the new tail so one rejection can't poison the
  // chain (and can't surface as an unhandled rejection from the queue itself).
  queues.set(
    db,
    started.then(
      () => undefined,
      () => undefined,
    ),
  );

  return started;
}

/// Run related writes atomically AND exclusively: BEGIN/COMMIT with ROLLBACK on
/// failure, serialized against every other `withTx`/`withDbLock` on the same
/// database. Without the transaction, a crash between an entry write and its
/// item rows leaves a meal without its breakdown; without the serialization,
/// two concurrent transactions lose one of them outright (see above).
///
/// ⚠️ Never call `withTx` or `withDbLock` from inside the body — pass the work
/// down as plain statements instead. The queue is FIFO and has no reentrancy.
export function withTx<T>(db: AnyDb, body: () => Promise<T>, label = 'withTx'): Promise<T> {
  return enqueue(
    db,
    async () => {
      await db.run(sql`BEGIN`);
      try {
        const out = await body();
        await db.run(sql`COMMIT`);
        return out;
      } catch (e) {
        try {
          await db.run(sql`ROLLBACK`);
        } catch {
          // Surfacing the original failure matters more than a rollback error.
        }
        throw e;
      }
    },
    label,
  );
}

/// Serialize work against the transaction queue WITHOUT opening a transaction.
///
/// For write batches that must not be swept into a neighbouring transaction's
/// rollback (failure mode 2), and for read batches that must see one consistent
/// moment. Prefer `withTx` when the writes also need to be all-or-nothing.
export function withDbLock<T>(db: AnyDb, body: () => Promise<T>, label = 'withDbLock'): Promise<T> {
  return enqueue(db, body, label);
}
