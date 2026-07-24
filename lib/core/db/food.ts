import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type {
  MealDraft,
  Minerals,
  NutrientValues,
  NutritionItem,
  Per100,
  Region,
  Vitamins,
} from '../services/foodParser';
import { displayItemName } from '../services/foodChoice';
import { recomputeDraft } from '../services/mealDraft';
import { mealTypeForEntry, type MealType } from '../insights/mealType';
import type { MicroRow } from '../insights/microNutrients';
import { foodEntries, foodItems, type FoodEntry, type FoodItem } from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = BaseSQLiteDatabase<any, any, any>;

export interface MacroTotals {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
}

export const zeroTotals: MacroTotals = { kcal: 0, proteinG: 0, fatG: 0, carbG: 0 };

const MINERAL_KEYS: readonly (keyof Minerals)[] = ['na', 'k', 'ca', 'mg', 'fe', 'zn'];
const VITAMIN_KEYS: readonly (keyof Vitamins)[] = ['a', 'd', 'e', 'c', 'b1', 'b2', 'b6', 'b9', 'b12'];

/// The one entry contributing most of a nutrient's day sum. Kept per key so an
/// outlier percentage can point back at its source meal: a cluster like
/// «A 686% · B12 1053% · железо 263%» is the signature of ONE mismatched DB row
/// (liver/fortified food matched instead of a plain dish), and the pure sum
/// can't say which of the day's meals to open and fix.
export interface MicroDonor {
  entryId: number;
  rawText: string;
  /// That entry's own amount of the nutrient (same unit as the day sum).
  value: number;
}

/// The day's summed micronutrients + honest coverage: `entriesWithData` of
/// `entriesTotal` meals actually carried micro data (most RU dishes carry none),
/// so the UI can say what the numbers are — and aren't — measured from.
export interface MicroTotals {
  minerals: Minerals;
  vitamins: Vitamins;
  /// Largest single-entry contribution per measured key. Filled only from rows
  /// that carried an entry id — callers passing bare `{micros}` still get sums.
  mineralsTop: Partial<Record<keyof Minerals, MicroDonor>>;
  vitaminsTop: Partial<Record<keyof Vitamins, MicroDonor>>;
  /// The day's dietary fibre (клетчатка), grams. Summed from the same stored
  /// blob but counted separately from `entriesWithData`: fibre is far more
  /// widely known than vitamins, so a fibre-only entry must not inflate the
  /// micronutrient coverage line.
  fiberG: number;
  entriesWithData: number;
  entriesTotal: number;
}

/// Serialize an entry's scaled micro totals to the stored JSON, or null when the
/// entry has no micro data at all (keeps the column empty rather than "{}").
export function encodeMicros(totals: NutrientValues): string | null {
  const minerals = totals.minerals && Object.keys(totals.minerals).length > 0 ? totals.minerals : undefined;
  const vitamins = totals.vitamins && Object.keys(totals.vitamins).length > 0 ? totals.vitamins : undefined;
  // Fibre rides in the same blob (it has no column of its own). A real 0 is kept
  // — "measured, none here" is information, and it's what lets the day total
  // stay honest instead of silently treating unknown as zero.
  const fiber = typeof totals.fiber === 'number' && Number.isFinite(totals.fiber) ? totals.fiber : undefined;
  if (!minerals && !vitamins && fiber === undefined) return null;
  return JSON.stringify({
    ...(minerals ? { minerals } : {}),
    ...(vitamins ? { vitamins } : {}),
    ...(fiber !== undefined ? { fiber } : {}),
  });
}

/// Parse a stored `micros` JSON back into a bounded {minerals, vitamins}. Only
/// known keys with finite numbers survive — never trusts arbitrary JSON shape.
function decodeMicros(
  raw: string | null | undefined,
): { minerals: Minerals; vitamins: Vitamins; fiber?: number } | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { minerals?: unknown; vitamins?: unknown; fiber?: unknown };
  const minerals: Minerals = {};
  const vitamins: Vitamins = {};
  const m = (p.minerals && typeof p.minerals === 'object' ? p.minerals : {}) as Record<string, unknown>;
  const v = (p.vitamins && typeof p.vitamins === 'object' ? p.vitamins : {}) as Record<string, unknown>;
  for (const key of MINERAL_KEYS) {
    if (typeof m[key] === 'number' && Number.isFinite(m[key])) minerals[key] = m[key] as number;
  }
  for (const key of VITAMIN_KEYS) {
    if (typeof v[key] === 'number' && Number.isFinite(v[key])) vitamins[key] = v[key] as number;
  }
  const fiber = typeof p.fiber === 'number' && Number.isFinite(p.fiber) ? p.fiber : undefined;
  const hasAny = Object.keys(minerals).length > 0 || Object.keys(vitamins).length > 0 || fiber !== undefined;
  return hasAny ? { minerals, vitamins, ...(fiber !== undefined ? { fiber } : {}) } : null;
}

/// Local-day [start, end) bounds for a given date.
export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/// Run related writes atomically: BEGIN/COMMIT with ROLLBACK on failure — the
/// same raw-SQL seam [importAllTables] uses (drizzle's `transaction()` isn't
/// wired for every driver this app runs on). Without this, a crash between an
/// entry write and its item rows leaves a meal without its breakdown.
async function withTx<T>(db: AnyDb, body: () => Promise<T>): Promise<T> {
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
}

/// Saves a confirmed meal plus its item breakdown. Returns the entry id.
///
/// The honest [MealDraft] (exact per-100g + scaled totals) collapses to the
/// stored shape here: each row keeps the SCALED macros for the confirmed grams,
/// which is the final fact once the user has set the weight.
export async function saveParsedEntry(
  db: AnyDb,
  opts: {
    rawText: string;
    source: 'voice' | 'text' | 'photo';
    draft: MealDraft;
    ts?: Date;
    /// User-picked meal of day (chips on the log screen). Null/omitted = not
    /// chosen; the day view falls back to the keyword/clock heuristic.
    meal?: MealType | null;
  },
): Promise<number> {
  const ts = opts.ts ?? new Date();
  const d = opts.draft;
  return withTx(db, async () => {
    const inserted = await db
      .insert(foodEntries)
      .values({
        ts,
        rawText: opts.rawText,
        source: opts.source,
        kcal: d.totals.kcal,
        proteinG: d.totals.prot,
        fatG: d.totals.fat,
        carbG: d.totals.carb,
        confirmed: true,
        micros: encodeMicros(d.totals),
        meal: opts.meal ?? null,
      })
      .returning({ id: foodEntries.id });

    const entryId = inserted[0].id as number;

    await insertDraftItems(db, entryId, d);
    return entryId;
  });
}

/// Insert the draft's item breakdown for an entry (each row holds the SCALED
/// macros for its confirmed grams). Shared by save + update so the two paths
/// can never drift apart.
async function insertDraftItems(db: AnyDb, entryId: number, d: MealDraft): Promise<void> {
  // Drop unfilled DB misses: their macros are the fabricated 'estimate'
  // placeholder, already excluded from the dish total, so persisting them would
  // reintroduce phantom calories on reload. A filled miss is 'manual' and kept.
  const items = d.items.filter((it) => it.per100.source !== 'estimate');
  if (items.length === 0) return;
  await db.insert(foodItems).values(
    items.map((it) => ({
      entryId,
      // Real DB name once the user re-picked a match; their own words otherwise.
      name: displayItemName(it, d.region),
      qtyG: it.grams,
      kcal: it.scaled.kcal,
      proteinG: it.scaled.prot,
      fatG: it.scaled.fat,
      carbG: it.scaled.carb,
    })),
  );
}

/// One stored entry plus its item rows — backs the view/edit screen.
export interface FoodEntryDetail {
  entry: FoodEntry;
  items: FoodItem[];
}

/// Load a single entry and its item breakdown, or null if it's gone.
export async function getFoodEntry(db: AnyDb, id: number): Promise<FoodEntryDetail | null> {
  const entries = (await db.select().from(foodEntries).where(eq(foodEntries.id, id))) as FoodEntry[];
  if (entries.length === 0) return null;
  const items = (await db
    .select()
    .from(foodItems)
    .where(eq(foodItems.entryId, id))
    .orderBy(foodItems.id)) as FoodItem[];
  return { entry: entries[0], items };
}

/// Replace a saved entry's macros/meta AND its full item set in one logical
/// edit: UPDATE the entry row, DELETE its old `food_items`, INSERT the new set.
/// The original `ts` is preserved unless a new one is given. Stays `confirmed`.
export async function updateFoodEntry(
  db: AnyDb,
  id: number,
  opts: {
    rawText: string;
    source: 'voice' | 'text' | 'photo';
    draft: MealDraft;
    ts?: Date;
    /// Meal of day: a MealType re-files the entry, explicit null clears the
    /// choice (back to the heuristic), omitted leaves the stored value alone.
    meal?: MealType | null;
  },
): Promise<void> {
  const d = opts.draft;
  await withTx(db, async () => {
    await db
      .update(foodEntries)
      .set({
        rawText: opts.rawText,
        source: opts.source,
        kcal: d.totals.kcal,
        proteinG: d.totals.prot,
        fatG: d.totals.fat,
        carbG: d.totals.carb,
        confirmed: true,
        micros: encodeMicros(d.totals),
        ...(opts.ts ? { ts: opts.ts } : {}),
        ...(opts.meal !== undefined ? { meal: opts.meal } : {}),
      })
      .where(eq(foodEntries.id, id));
    // Replace the item set as a unit. Delete explicitly (not relying on the FK
    // cascade) so no `food_items` are orphaned even if PRAGMA foreign_keys is off.
    await db.delete(foodItems).where(eq(foodItems.entryId, id));
    await insertDraftItems(db, id, d);
  });
}

/// ——— Background (adopted) parses: entries that exist BEFORE their parse ———

/// A placeholder entry for a photo whose parse is still running after the user
/// left the log screen. Zero macros on purpose: the day's sums stay honest
/// while the row renders as «разбирается…» off `parse_status`.
export async function savePendingEntry(
  db: AnyDb,
  opts: { source: 'voice' | 'text' | 'photo'; meal?: MealType | null; ts?: Date },
): Promise<number> {
  const inserted = await db
    .insert(foodEntries)
    .values({
      ts: opts.ts ?? new Date(),
      rawText: '',
      source: opts.source,
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbG: 0,
      confirmed: false,
      micros: null,
      meal: opts.meal ?? null,
      parseStatus: 'pending',
    })
    .returning({ id: foodEntries.id });
  return inserted[0].id as number;
}

/// The adopted parse landed: fill the placeholder with the draft — but leave it
/// UNCONFIRMED, unlike updateFoodEntry (which records a user-reviewed edit).
/// Hybrid review by design: the day list shows «≈ проверьте» until the entry is
/// opened — review is deferred, never skipped.
export async function applyDraftToPendingEntry(
  db: AnyDb,
  id: number,
  opts: { rawText: string; draft: MealDraft },
): Promise<void> {
  const d = opts.draft;
  await withTx(db, async () => {
    await db
      .update(foodEntries)
      .set({
        rawText: opts.rawText,
        kcal: d.totals.kcal,
        proteinG: d.totals.prot,
        fatG: d.totals.fat,
        carbG: d.totals.carb,
        micros: encodeMicros(d.totals),
        parseStatus: null,
      })
      .where(eq(foodEntries.id, id));
    await db.delete(foodItems).where(eq(foodItems.entryId, id));
    await insertDraftItems(db, id, d);
  });
}

export async function markPendingFailed(db: AnyDb, id: number): Promise<void> {
  await db.update(foodEntries).set({ parseStatus: 'failed' }).where(eq(foodEntries.id, id));
}

export async function markPendingRetrying(db: AnyDb, id: number): Promise<void> {
  await db.update(foodEntries).set({ parseStatus: 'pending' }).where(eq(foodEntries.id, id));
}

/// Opening an entry IS the deferred review — flip the flag so the «≈ проверьте»
/// pill rests once a human has actually looked at the numbers.
export async function confirmFoodEntry(db: AnyDb, id: number): Promise<void> {
  await db.update(foodEntries).set({ confirmed: true }).where(eq(foodEntries.id, id));
}

/// App-start hygiene: a 'pending' row can only finish while its process lives —
/// the photo is never persisted (privacy §2) — so anything still pending after
/// `maxAgeMin` belongs to a dead process and becomes an honest, retry-visible
/// 'failed' («снимите заново») instead of spinning forever.
export async function sweepStalePendingEntries(db: AnyDb, maxAgeMin = 15): Promise<void> {
  const cutoff = new Date(Date.now() - maxAgeMin * 60_000);
  await db
    .update(foodEntries)
    .set({ parseStatus: 'failed' })
    .where(and(eq(foodEntries.parseStatus, 'pending'), lt(foodEntries.ts, cutoff)));
}

/// Delete an entry and its items. Items are removed explicitly first so there
/// are never orphan `food_items` rows regardless of the FK-cascade pragma.
export async function deleteFoodEntry(db: AnyDb, id: number): Promise<void> {
  await withTx(db, async () => {
    await db.delete(foodItems).where(eq(foodItems.entryId, id));
    await db.delete(foodEntries).where(eq(foodEntries.id, id));
  });
}

/// Re-log a past meal as of `ts` (default: now) — copies the entry row AND its
/// item breakdown into a new confirmed entry. Backs the one-tap «Повторить» in
/// the diary: the numbers were confirmed once, no parse or review needed.
/// Returns the new entry id, or null when the original is gone.
export async function repeatFoodEntry(db: AnyDb, id: number, ts: Date = new Date()): Promise<number | null> {
  const detail = await getFoodEntry(db, id);
  if (!detail) return null;
  const e = detail.entry;
  return withTx(db, async () => {
    const inserted = await db
      .insert(foodEntries)
      .values({
        ts,
        rawText: e.rawText,
        source: e.source,
        kcal: e.kcal,
        proteinG: e.proteinG,
        fatG: e.fatG,
        carbG: e.carbG,
        confirmed: true,
        // The re-logged meal is the same food — carry its micro totals forward so
        // «Повторить» counts toward the day's micronutrients like the original.
        micros: e.micros,
        // Deliberately NOT copied: the copy happens at a new time of day, so its
        // meal is re-derived from the new clock by the day view (breakfast eggs
        // repeated at 20:00 belong to ужин, not to the original's завтрак).
        meal: null,
      })
      .returning({ id: foodEntries.id });
    const newId = inserted[0].id as number;
    if (detail.items.length > 0) {
      await db.insert(foodItems).values(
        detail.items.map((it) => ({
          entryId: newId,
          name: it.name,
          qtyG: it.qtyG,
          kcal: it.kcal,
          proteinG: it.proteinG,
          fatG: it.fatG,
          carbG: it.carbG,
        })),
      );
    }
    return newId;
  });
}

/// Rebuild an editable [MealDraft] from a stored entry + items. Storage keeps
/// only the SCALED macros (provenance/minerals are lost), so each item's per-100g
/// is *derived back* from `scaled / grams` purely to let grams edits rescale; the
/// initially-shown `scaled` stays the exact stored fact. Pure — no db access.
export function draftFromStoredEntry(region: Region, items: FoodItem[]): MealDraft {
  const nItems: NutritionItem[] = items.map((it) => {
    const grams = it.qtyG && it.qtyG > 0 ? it.qtyG : 100;
    const factor = grams / 100;
    const per100: Per100 = {
      kcal: Math.round(it.kcal / factor),
      prot: Math.round((it.proteinG / factor) * 10) / 10,
      fat: Math.round((it.fatG / factor) * 10) / 10,
      carb: Math.round((it.carbG / factor) * 10) / 10,
      minerals: {},
      // Provenance wasn't stored; the saved scaled macro is the user's own
      // recorded fact, so tag it 'history' (their journal) — NOT 'estimate',
      // which now means an unfilled DB miss the total deliberately skips.
      source: 'history',
    };
    return {
      name_ru: it.name,
      name_en: it.name,
      grams,
      grams_source: 'confirmed',
      confidence: 1,
      per100,
      // Keep the exact stored totals for the initial render (lossless until edited).
      scaled: { kcal: it.kcal, prot: it.proteinG, fat: it.fatG, carb: it.carbG, minerals: {} },
      approximate: false,
    };
  });
  return recomputeDraft(region, nItems);
}

/// Sums macro totals across all entries logged on [date]'s local day.
export async function todayMacroTotals(
  db: AnyDb,
  date: Date = new Date(),
): Promise<MacroTotals> {
  const { start, end } = dayBounds(date);
  const rows: FoodEntry[] = await db
    .select()
    .from(foodEntries)
    .where(and(gte(foodEntries.ts, start), lt(foodEntries.ts, end)));
  return rows.reduce<MacroTotals>(
    (acc, r) => ({
      kcal: acc.kcal + r.kcal,
      proteinG: acc.proteinG + r.proteinG,
      fatG: acc.fatG + r.fatG,
      carbG: acc.carbG + r.carbG,
    }),
    { ...zeroTotals },
  );
}

/// Sums the day's micronutrients across every entry that stored a `micros`
/// blob, and reports coverage (how many of the day's meals actually carried
/// data). Pure aggregation over stored facts — no norms, no judgement; the UI
/// compares against the reference norms and says what's still unmeasured.
/// Alongside each sum it keeps the largest single-entry contribution (id +
/// name), so an anomalous total stays attributable to the meal behind it.
export function sumMicroRows(
  rows: { id?: number; rawText?: string | null; micros?: string | null }[],
): MicroTotals {
  const minerals: Minerals = {};
  const vitamins: Vitamins = {};
  const mineralsTop: Partial<Record<keyof Minerals, MicroDonor>> = {};
  const vitaminsTop: Partial<Record<keyof Vitamins, MicroDonor>> = {};
  let entriesWithData = 0;
  let fiberG = 0;
  for (const r of rows) {
    const decoded = decodeMicros(r.micros);
    if (!decoded) continue;
    if (typeof decoded.fiber === 'number') fiberG = round2(fiberG + decoded.fiber);
    // Coverage counts VITAMIN/MINERAL data only — an entry that carried nothing
    // but fibre must not make the micronutrient line overstate what's measured.
    if (Object.keys(decoded.minerals).length === 0 && Object.keys(decoded.vitamins).length === 0) continue;
    entriesWithData += 1;
    for (const key of MINERAL_KEYS) {
      const v = decoded.minerals[key];
      if (typeof v !== 'number') continue;
      minerals[key] = round2((minerals[key] ?? 0) + v);
      const top = mineralsTop[key];
      if (r.id != null && (top == null || v > top.value)) {
        mineralsTop[key] = { entryId: r.id, rawText: r.rawText ?? '', value: v };
      }
    }
    for (const key of VITAMIN_KEYS) {
      const v = decoded.vitamins[key];
      if (typeof v !== 'number') continue;
      vitamins[key] = round2((vitamins[key] ?? 0) + v);
      const top = vitaminsTop[key];
      if (r.id != null && (top == null || v > top.value)) {
        vitaminsTop[key] = { entryId: r.id, rawText: r.rawText ?? '', value: v };
      }
    }
  }
  return { minerals, vitamins, mineralsTop, vitaminsTop, fiberG, entriesWithData, entriesTotal: rows.length };
}

/// Donor call-out gates: the day's sum must itself look anomalous (≥150 % of
/// the norm — the only defined upper limit, sodium's 2300 vs the 1500 norm,
/// sits just past this line too) AND one entry must carry more than half of the
/// sum. Both together keep ordinary well-fed days silent.
const DONOR_MIN_OF_NORM = 1.5;
const DONOR_MIN_SHARE = 0.5;

export interface MicroDonorCallout {
  entryId: number;
  rawText: string;
  /// The donor's share of the day's sum, 0..1 (already past the ½ gate).
  share: number;
}

/// The single meal behind an outlier percentage, or null on a normal day.
/// `row.value` is the same norm the visible «N % нормы» is computed against,
/// so the call-out fires exactly for the percentages the user finds scary.
export function microDonor(totals: MicroTotals, row: MicroRow): MicroDonorCallout | null {
  const sums = (row.group === 'mineral' ? totals.minerals : totals.vitamins) as Record<string, number | undefined>;
  const tops = (row.group === 'mineral' ? totals.mineralsTop : totals.vitaminsTop) as Record<
    string,
    MicroDonor | undefined
  >;
  const intake = sums[row.key];
  const top = tops[row.key];
  if (intake == null || top == null) return null;
  if (!(row.value > 0) || intake < row.value * DONOR_MIN_OF_NORM) return null;
  const share = top.value / intake;
  if (share <= DONOR_MIN_SHARE) return null;
  return { entryId: top.entryId, rawText: top.rawText, share };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/// The day's micronutrient roll-up (minerals + vitamins) across all entries
/// logged on [date]'s local day. Reads the stored per-entry `micros` blobs.
export async function todayMicroTotals(db: AnyDb, date: Date = new Date()): Promise<MicroTotals> {
  const { start, end } = dayBounds(date);
  const rows = (await db
    .select({ id: foodEntries.id, rawText: foodEntries.rawText, micros: foodEntries.micros })
    .from(foodEntries)
    .where(and(gte(foodEntries.ts, start), lt(foodEntries.ts, end)))) as {
    id: number;
    rawText: string;
    micros: string | null;
  }[];
  return sumMicroRows(rows);
}

/// How many DISTINCT food items were logged today (case-insensitive on the
/// item name). Powers the body-neutral "variety" line (A5) — no nutrition data
/// beyond what's already stored is assumed.
export async function distinctFoodItemsToday(
  db: AnyDb,
  date: Date = new Date(),
): Promise<number> {
  const { start, end } = dayBounds(date);
  const rows = (await db
    .select({ name: foodItems.name })
    .from(foodItems)
    .innerJoin(foodEntries, eq(foodItems.entryId, foodEntries.id))
    .where(and(gte(foodEntries.ts, start), lt(foodEntries.ts, end)))) as { name: string }[];
  const distinct = new Set<string>();
  for (const r of rows) distinct.add(r.name.trim().toLowerCase());
  return distinct.size;
}

/// A one-tap re-loggable meal derived from history (no LLM, no typing).
export interface QuickMeal {
  rawText: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  count: number;
  /// Dominant meal-of-day this dish was logged at across history (most-frequent,
  /// ties → latest). Lets the log screen surface breakfast history first when the
  /// user is logging breakfast. Always set by [groupMeals].
  meal: MealType;
}

interface QuickSourceEntry {
  rawText: string;
  ts: Date;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  /// The user's stored meal chip, if any. Absent/null → the keyword/clock
  /// heuristic decides, same rule the day view uses.
  meal?: MealType | null;
}

/// Derives quick-add lists from past entries. `recents` = the most recent
/// distinct meals; `favorites` = the most repeated ones (count ≥ 2, since a
/// repeat is what's worth one-tapping). Each carries the macros from its latest
/// occurrence. Pure (grouping/ordering only) so it's unit-testable and
/// independent of row order.
export function deriveQuickMeals(
  entries: QuickSourceEntry[],
  opts: { recentLimit?: number; favoriteLimit?: number } = {},
): { recents: QuickMeal[]; favorites: QuickMeal[] } {
  const recentLimit = opts.recentLimit ?? 6;
  const favoriteLimit = opts.favoriteLimit ?? 6;

  const all = groupMeals(entries);
  const recents = [...all]
    .sort((a, b) => b.latestTs - a.latestTs)
    .slice(0, recentLimit)
    .map((g) => g.meal);
  const favorites = all
    .filter((g) => g.meal.count >= 2)
    .sort((a, b) => b.meal.count - a.meal.count || b.latestTs - a.latestTs)
    .slice(0, favoriteLimit)
    .map((g) => g.meal);
  return { recents, favorites };
}

/// Most-frequent meal-of-day in a group's `tally`, ties broken toward the
/// `latest` occurrence — a dish usually eaten at breakfast stays breakfast even
/// if the last log happened to be an odd-hour snack.
function dominantMeal(tally: Map<MealType, number>, latest: MealType): MealType {
  let best = latest;
  let bestN = tally.get(latest) ?? 0;
  for (const [m, n] of tally) {
    if (n > bestN) {
      best = m;
      bestN = n;
    }
  }
  return best;
}

/// Groups entries by normalized name → one `QuickMeal` each (count = repeats,
/// macros/label from the most recent occurrence, `meal` = dominant meal-of-day).
/// Order-independent; shared by `deriveQuickMeals` and `deriveDayMeals`.
function groupMeals(entries: QuickSourceEntry[]): { meal: QuickMeal; latestTs: number }[] {
  const groups = new Map<
    string,
    { meal: QuickMeal; latestTs: number; tally: Map<MealType, number>; latestMeal: MealType }
  >();
  for (const e of entries) {
    const key = e.rawText.trim().toLowerCase();
    if (key.length === 0) continue;
    const ts = e.ts.getTime();
    // Effective meal-of-day for this occurrence: the user's stored chip wins,
    // else the keyword/clock heuristic — the same rule the day view applies.
    const eff = e.meal ?? mealTypeForEntry(e.rawText, e.ts);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        latestTs: ts,
        latestMeal: eff,
        tally: new Map([[eff, 1]]),
        meal: {
          rawText: e.rawText.trim(),
          kcal: e.kcal,
          proteinG: e.proteinG,
          fatG: e.fatG,
          carbG: e.carbG,
          count: 1,
          meal: eff,
        },
      });
      continue;
    }
    existing.meal.count += 1;
    existing.tally.set(eff, (existing.tally.get(eff) ?? 0) + 1);
    // Keep macros + label from the most recent occurrence (order-independent).
    if (ts > existing.latestTs) {
      existing.latestTs = ts;
      existing.latestMeal = eff;
      existing.meal = {
        ...existing.meal,
        rawText: e.rawText.trim(),
        kcal: e.kcal,
        proteinG: e.proteinG,
        fatG: e.fatG,
        carbG: e.carbG,
      };
    }
  }
  for (const g of groups.values()) g.meal.meal = dominantMeal(g.tally, g.latestMeal);
  return [...groups.values()].map((g) => ({ meal: g.meal, latestTs: g.latestTs }));
}

/// Distinct meals logged on [date]'s local day, newest first — powers the
/// one-tap "same as yesterday" re-log (A4). Pure; no schema change.
export function deriveDayMeals(
  entries: QuickSourceEntry[],
  date: Date,
  limit = 6,
): QuickMeal[] {
  const { start, end } = dayBounds(date);
  const onDay = entries.filter((e) => e.ts >= start && e.ts < end);
  return groupMeals(onDay)
    .sort((a, b) => b.latestTs - a.latestTs)
    .slice(0, limit)
    .map((g) => g.meal);
}

/// Stable-reorders quick meals so those whose dominant meal-of-day matches
/// `current` lead — the log screen calls this so logging завтрак surfaces
/// breakfast history first, обед/ужин after. Nothing is dropped; order within
/// each partition is preserved (callers slice afterwards).
export function orderByMeal(meals: QuickMeal[], current: MealType): QuickMeal[] {
  const lead: QuickMeal[] = [];
  const rest: QuickMeal[] = [];
  for (const m of meals) (m.meal === current ? lead : rest).push(m);
  return [...lead, ...rest];
}

/// Quick-add lists drawn from the last [scan] confirmed entries.
export async function quickMeals(
  db: AnyDb,
  opts: { recentLimit?: number; favoriteLimit?: number; scan?: number } = {},
  now: Date = new Date(),
): Promise<{ recents: QuickMeal[]; favorites: QuickMeal[]; yesterday: QuickMeal[] }> {
  const rows = (await db
    .select({
      rawText: foodEntries.rawText,
      ts: foodEntries.ts,
      kcal: foodEntries.kcal,
      proteinG: foodEntries.proteinG,
      fatG: foodEntries.fatG,
      carbG: foodEntries.carbG,
      meal: foodEntries.meal,
    })
    .from(foodEntries)
    .where(eq(foodEntries.confirmed, true))
    .orderBy(desc(foodEntries.ts))
    .limit(opts.scan ?? 200)) as QuickSourceEntry[];
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  // Yesterday's meals get their OWN day-bounded query. Deriving them from the
  // `scan`-limited `rows` above dropped "same as yesterday" for heavy loggers:
  // once today's confirmed entries fill the scan window, yesterday never appears
  // in `rows` at all. Query yesterday's local day directly instead.
  const { start, end } = dayBounds(yesterdayDate);
  const yesterdayRows = (await db
    .select({
      rawText: foodEntries.rawText,
      ts: foodEntries.ts,
      kcal: foodEntries.kcal,
      proteinG: foodEntries.proteinG,
      fatG: foodEntries.fatG,
      carbG: foodEntries.carbG,
      meal: foodEntries.meal,
    })
    .from(foodEntries)
    .where(and(eq(foodEntries.confirmed, true), gte(foodEntries.ts, start), lt(foodEntries.ts, end)))
    .orderBy(desc(foodEntries.ts))) as QuickSourceEntry[];
  return {
    ...deriveQuickMeals(rows, opts),
    yesterday: deriveDayMeals(yesterdayRows, yesterdayDate, opts.recentLimit ?? 6),
  };
}

/// Entries logged on [date]'s local day, newest first.
export async function listEntriesForDay(
  db: AnyDb,
  date: Date = new Date(),
): Promise<FoodEntry[]> {
  const { start, end } = dayBounds(date);
  return (await db
    .select()
    .from(foodEntries)
    .where(and(gte(foodEntries.ts, start), lt(foodEntries.ts, end)))
    .orderBy(desc(foodEntries.ts))) as FoodEntry[];
}

/// Per-day macro totals for the last [days] local calendar days, today
/// included — one range query grouped by day key. Powers the day-history list
/// («выбрать прошлый день и посмотреть логи»): a day absent from the map had
/// no food entries at all.
export async function macroTotalsByDay(
  db: AnyDb,
  days: number,
  now: Date = new Date(),
): Promise<Map<string, MacroTotals>> {
  const { end } = dayBounds(now);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const rows: FoodEntry[] = await db
    .select()
    .from(foodEntries)
    .where(and(gte(foodEntries.ts, start), lt(foodEntries.ts, end)));
  const byDay = new Map<string, MacroTotals>();
  for (const r of rows) {
    const key = localDayKey(new Date(r.ts));
    const acc = byDay.get(key) ?? { ...zeroTotals };
    acc.kcal += r.kcal;
    acc.proteinG += r.proteinG;
    acc.fatG += r.fatG;
    acc.carbG += r.carbG;
    byDay.set(key, acc);
  }
  return byDay;
}

/// Local 'YYYY-MM-DD' of a date — mirrors steps.dayKey without coupling the
/// food module to the steps module.
function localDayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
