import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { MealDraft } from '../services/foodParser';
import { foodEntries, foodItems, type FoodEntry } from './schema';

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

  if (d.items.length > 0) {
    await db.insert(foodItems).values(
      d.items.map((it) => ({
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
  return entryId;
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

  const all = [...groups.values()];
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

/// Quick-add lists drawn from the last [scan] confirmed entries.
export async function quickMeals(
  db: AnyDb,
  opts: { recentLimit?: number; favoriteLimit?: number; scan?: number } = {},
): Promise<{ recents: QuickMeal[]; favorites: QuickMeal[] }> {
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
  return deriveQuickMeals(rows, opts);
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
