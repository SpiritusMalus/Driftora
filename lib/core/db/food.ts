import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { MealDraft, NutritionItem, Per100, Region } from '../services/foodParser';
import { recomputeDraft } from '../services/mealDraft';
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

/// Local-day [start, end) bounds for a given date.
export function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
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
  },
): Promise<number> {
  const ts = opts.ts ?? new Date();
  const d = opts.draft;
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
    })
    .returning({ id: foodEntries.id });

  const entryId = inserted[0].id as number;

  await insertDraftItems(db, entryId, d);
  return entryId;
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
      name: it.name_ru,
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
  opts: { rawText: string; source: 'voice' | 'text' | 'photo'; draft: MealDraft; ts?: Date },
): Promise<void> {
  const d = opts.draft;
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
      ...(opts.ts ? { ts: opts.ts } : {}),
    })
    .where(eq(foodEntries.id, id));
  // Replace the item set as a unit. Delete explicitly (not relying on the FK
  // cascade) so no `food_items` are orphaned even if PRAGMA foreign_keys is off.
  await db.delete(foodItems).where(eq(foodItems.entryId, id));
  await insertDraftItems(db, id, d);
}

/// Delete an entry and its items. Items are removed explicitly first so there
/// are never orphan `food_items` rows regardless of the FK-cascade pragma.
export async function deleteFoodEntry(db: AnyDb, id: number): Promise<void> {
  await db.delete(foodItems).where(eq(foodItems.entryId, id));
  await db.delete(foodEntries).where(eq(foodEntries.id, id));
}

/// Re-log a past meal as of `ts` (default: now) — copies the entry row AND its
/// item breakdown into a new confirmed entry. Backs the one-tap «Повторить» in
/// the diary: the numbers were confirmed once, no parse or review needed.
/// Returns the new entry id, or null when the original is gone.
export async function repeatFoodEntry(db: AnyDb, id: number, ts: Date = new Date()): Promise<number | null> {
  const detail = await getFoodEntry(db, id);
  if (!detail) return null;
  const e = detail.entry;
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
}

interface QuickSourceEntry {
  rawText: string;
  ts: Date;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
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

/// Groups entries by normalized name → one `QuickMeal` each (count = repeats,
/// macros/label from the most recent occurrence). Order-independent; shared by
/// `deriveQuickMeals` and `deriveDayMeals`.
function groupMeals(entries: QuickSourceEntry[]): { meal: QuickMeal; latestTs: number }[] {
  const groups = new Map<string, { meal: QuickMeal; latestTs: number }>();
  for (const e of entries) {
    const key = e.rawText.trim().toLowerCase();
    if (key.length === 0) continue;
    const ts = e.ts.getTime();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        latestTs: ts,
        meal: {
          rawText: e.rawText.trim(),
          kcal: e.kcal,
          proteinG: e.proteinG,
          fatG: e.fatG,
          carbG: e.carbG,
          count: 1,
        },
      });
      continue;
    }
    existing.meal.count += 1;
    // Keep macros + label from the most recent occurrence (order-independent).
    if (ts > existing.latestTs) {
      existing.latestTs = ts;
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
  return [...groups.values()];
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
    })
    .from(foodEntries)
    .where(eq(foodEntries.confirmed, true))
    .orderBy(desc(foodEntries.ts))
    .limit(opts.scan ?? 200)) as QuickSourceEntry[];
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  return {
    ...deriveQuickMeals(rows, opts),
    yesterday: deriveDayMeals(rows, yesterdayDate, opts.recentLimit ?? 6),
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
