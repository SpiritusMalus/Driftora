import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * A tiny append-only JSONL record log: last line about an id wins, periodically
 * rewritten as one line per record.
 *
 * Prod runs Node 20, so `node:sqlite` is not available, and the volumes here are
 * one line per PURCHASE EVENT — not per request. A log plus an in-memory index
 * is the honest size of the problem; a database would be a dependency and an
 * operational surface bought for nothing.
 *
 * (`entitlements.ts` predates this helper and keeps its own copy of the same
 * shape. Left alone deliberately: it is tested and in use, and rewriting working
 * storage code to save thirty lines is a bad trade.)
 */
export interface RecordLog<T> {
  get: (id: string) => T | undefined;
  put: (rec: T) => void;
  values: () => T[];
  size: () => number;
}

/** Rewrite once the log is mostly superseded lines. */
const COMPACT_RATIO = 4;
const COMPACT_FLOOR = 64;

export function createRecordLog<T extends object>(
  path: string,
  idOf: (rec: T) => string,
  isValid: (rec: unknown) => boolean,
): RecordLog<T> {
  const byId = new Map<string, T>();
  let appended = 0;

  function load(): void {
    if (!path || !existsSync(path)) return;
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (err) {
      // Starting with an empty index degrades paying users to the free tier
      // until they re-register — recoverable. Refusing to boot is not.
      console.error('recordLog: load failed:', err instanceof Error ? err.message : String(err));
      return;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as T;
        if (!isValid(rec)) continue;
        byId.set(idOf(rec), rec);
        appended += 1;
      } catch {
        // One torn line (power loss mid-write) must not discard the rest.
      }
    }
  }

  function compact(): void {
    const tmp = `${path}.tmp`;
    const body = [...byId.values()].map((r) => JSON.stringify(r)).join('\n');
    writeFileSync(tmp, body ? `${body}\n` : '');
    renameSync(tmp, path);
    appended = byId.size;
  }

  function put(rec: T): void {
    byId.set(idOf(rec), rec);
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(rec)}\n`);
      appended += 1;
    } catch (err) {
      // In memory it is already applied, so the customer keeps what they bought
      // until the next restart. Loud, because a deploy WILL forget it.
      console.error('recordLog: persist failed:', err instanceof Error ? err.message : String(err));
      return;
    }
    if (appended > byId.size * COMPACT_RATIO && appended > COMPACT_FLOOR) {
      try {
        compact();
      } catch (err) {
        // A failed compaction leaves a correct, merely longer log — reporting it
        // as a write failure would send someone hunting for lost purchases.
        console.error('recordLog: compaction failed:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  load();

  return {
    get: (id) => byId.get(id),
    put,
    values: () => [...byId.values()],
    size: () => byId.size,
  };
}
