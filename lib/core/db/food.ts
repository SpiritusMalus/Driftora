import { and, desc, gte, lt } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type { FoodParseResult } from '../services/foodParser';
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

/// Saves a confirmed food entry plus its item breakdown. Returns the entry id.
export async function saveParsedEntry(
  db: AnyDb,
  opts: {
    rawText: string;
    source: 'voice' | 'text';
    result: FoodParseResult;
    ts?: Date;
  },
): Promise<number> {
  const ts = opts.ts ?? new Date();
  const r = opts.result;
  const inserted = await db
    .insert(foodEntries)
    .values({
      ts,
      rawText: opts.rawText,
      source: opts.source,
      kcal: r.kcal,
      proteinG: r.proteinG,
      fatG: r.fatG,
      carbG: r.carbG,
      confirmed: true,
    })
    .returning({ id: foodEntries.id });

  const entryId = inserted[0].id as number;

  if (r.items.length > 0) {
    await db.insert(foodItems).values(
      r.items.map((it) => ({
        entryId,
        name: it.name,
        qtyG: it.qtyG,
        kcal: it.kcal,
        proteinG: it.proteinG,
        fatG: it.fatG,
        carbG: it.carbG,
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
