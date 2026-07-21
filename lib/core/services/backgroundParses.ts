import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import {
  applyDraftToPendingEntry,
  markPendingFailed,
  markPendingRetrying,
  savePendingEntry,
} from '../db/food';
import { loadRememberedChoices } from '../db/foodChoices';
import { applyRememberedChoices, displayItemName } from './foodChoice';
import type { MealDraft, PhotoInput, Region } from './foodParser';
import { getFoodParser } from './foodParserProvider';
import { deleteTempFile } from './tempFiles';
import type { MealType } from '../insights/mealType';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

/// Background photo-parse hand-off. Leaving the log screen mid-parse (or with a
/// queued multi-photo batch) must not kill the work: the screen registers its
/// in-flight parse and queue here, and `adoptOnUnmount` turns them into
/// «разбирается…» entries that finish (or fail retry-ably) on their own.
///
/// Hybrid confirmation by design: an adopted result saves UNCONFIRMED and the
/// day list shows «≈ проверьте» until the entry is opened — review is deferred,
/// never skipped (показываем факты, не магию).
///
/// Module-level on purpose: the work must outlive any screen. Photos stay ONLY
/// in this process's memory/cache — never persisted (privacy §2) — so a parse
/// that outlives the process becomes an honest «снимите заново» via
/// `sweepStalePendingEntries`, not a silent forever-spinner.

interface InFlightParse {
  promise: Promise<MealDraft>;
  photo: PhotoInput;
}

interface RetryMaterial {
  photo: PhotoInput;
  region: Region;
  consent: boolean;
}

let inFlight: InFlightParse | null = null;
/// Photo uris the service took over — the log screen's own settle path checks
/// this to stand down (no double delete, no setState into a dead screen).
const adoptedUris = new Set<string>();
/// entryId → what a retry needs. This process only: the photo dies with it.
const retryMaterial = new Map<number, RetryMaterial>();
const listeners = new Set<() => void>();

export function registerInFlight(parse: InFlightParse): void {
  inFlight = parse;
}

export function clearInFlight(uri: string): void {
  if (inFlight?.photo.uri === uri) inFlight = null;
}

export function isAdopted(uri: string): boolean {
  return adoptedUris.has(uri);
}

/// Day-screen subscription: fires once per settled background parse.
export function subscribeBackgroundParses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

/// A draft that would persist as an empty zero-kcal row: nothing savable — the
/// entry stays retry-able 'failed' instead. Covers a fallback/refused parse AND
/// the all-misses answer (every item an unfilled 'estimate' placeholder, which
/// insertDraftItems drops): with nobody on the screen to fill the blanks in,
/// «ничего пригодного» must not masquerade as a logged meal.
function unusable(d: MealDraft): boolean {
  const savable = d.items.some((it) => it.per100.source !== 'estimate');
  return (
    !savable ||
    d.flags.offline_fallback === true ||
    d.flags.server_error === true ||
    d.flags.quota_exceeded === true
  );
}

/// Await one adopted parse and write its outcome. Exported for tests — the
/// wiring above it is thin, THIS is the behavior worth pinning.
export async function runAdoptedParse(
  db: AnyDb,
  entryId: number,
  draftPromise: Promise<MealDraft>,
  ctx: { region: Region; photo: PhotoInput },
): Promise<void> {
  try {
    let draft = await draftPromise;
    // Same personal-journal memory as the on-screen path — an adopted parse
    // must not resolve differently from a watched one.
    const remembered = await loadRememberedChoices(db, ctx.region, draft);
    draft = applyRememberedChoices(draft, ctx.region, remembered);
    if (unusable(draft)) {
      await markPendingFailed(db, entryId); // photo kept for retry
    } else {
      const rawText = draft.items.map((it) => displayItemName(it, ctx.region)).join(', ');
      await applyDraftToPendingEntry(db, entryId, { rawText, draft });
      retryMaterial.delete(entryId);
      adoptedUris.delete(ctx.photo.uri);
      deleteTempFile(ctx.photo.uri);
    }
  } catch {
    // A throw is local (db write) or a parser bug — either way the entry must
    // not stay «разбирается…» forever.
    await markPendingFailed(db, entryId).catch(() => undefined);
  } finally {
    notify();
  }
}

/// Called from the log screen's unmount cleanup. Takes whatever is running
/// and/or queued and continues it here; no-op when there is nothing to adopt.
export function adoptOnUnmount(
  db: AnyDb,
  ctx: { queued: PhotoInput[]; region: Region; meal: MealType | null; consent: boolean },
): void {
  const flight = inFlight;
  inFlight = null;
  if (!flight && ctx.queued.length === 0) return;
  // Mark adopted uris SYNCHRONOUSLY: the caller's very next line sweeps the
  // queue's temp files, and anything not marked by then would be deleted out
  // from under the parse we are about to run.
  if (flight) adoptedUris.add(flight.photo.uri);
  for (const photo of ctx.queued) adoptedUris.add(photo.uri);
  void (async () => {
    try {
      if (flight) {
        const entryId = await savePendingEntry(db, { source: 'photo', meal: ctx.meal });
        retryMaterial.set(entryId, { photo: flight.photo, region: ctx.region, consent: ctx.consent });
        notify();
        // Reuses the ALREADY RUNNING request — adoption must not re-bill a
        // parse that is seconds from landing.
        await runAdoptedParse(db, entryId, flight.promise, { region: ctx.region, photo: flight.photo });
      }
      // Queued shots: their pending rows appear at once (the day list shows the
      // whole batch), then they parse strictly one at a time — same politeness
      // to the server as the on-screen queue.
      const queue: { entryId: number; photo: PhotoInput }[] = [];
      for (const photo of ctx.queued) {
        const entryId = await savePendingEntry(db, { source: 'photo', meal: ctx.meal });
        retryMaterial.set(entryId, { photo, region: ctx.region, consent: ctx.consent });
        queue.push({ entryId, photo });
      }
      if (queue.length > 0) notify();
      for (const q of queue) {
        await runAdoptedParse(db, q.entryId, getFoodParser(ctx.consent).parsePhoto(q.photo, ctx.region), {
          region: ctx.region,
          photo: q.photo,
        });
      }
    } catch {
      // savePendingEntry threw (db gone mid-teardown) — nothing to surface to:
      // the temp files stay for the cache cleaner, no entry means no ghost row.
    }
  })();
}

/// Tap-to-retry on a 'failed' row. False when this process no longer holds the
/// photo (app restarted) — the caller says «снимите заново» honestly.
export async function retryParse(db: AnyDb, entryId: number): Promise<boolean> {
  const kept = retryMaterial.get(entryId);
  if (!kept) return false;
  await markPendingRetrying(db, entryId);
  notify();
  await runAdoptedParse(db, entryId, getFoodParser(kept.consent).parsePhoto(kept.photo, kept.region), {
    region: kept.region,
    photo: kept.photo,
  });
  return true;
}
