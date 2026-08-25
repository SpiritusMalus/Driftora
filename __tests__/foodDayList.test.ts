import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * THE DAY LIST ⇄ LOG SCREEN DAY CONTRACT (device feedback 2026-08-25: «хочу
 * переключиться на любую дату и чтобы у меня было меню как будто я в
 * сегодняшней»).
 *
 * The food day list owns a DayNav; on a past day its «Добавить» must open the
 * log screen ALREADY aimed at that day — the aim travels as a ?day= route
 * param. This is a cross-file coupling exactly like the back-stack one in
 * foodLogExit.test.ts: each side reads fine alone, and either side silently
 * dropping its half (index stops sending, or log stops reading/validating)
 * would quietly re-point past-day saves at today.
 */

const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('adding food to a past day from the day list', () => {
  const index = read('app/food/index.tsx');
  const log = read('app/food/log.tsx');

  it('the day list sends the selected day to the log screen', () => {
    expect(index).toMatch(/router\.push\([^)]*\/food\/log\?day=/);
  });

  it('the log screen consumes the ?day= param into its DayNav state', () => {
    expect(log).toMatch(/useLocalSearchParams<\{[^}]*day\?/);
    // The param must be validated, not trusted: a malformed or future key
    // falls back to today (a deep link must not aim a save at tomorrow).
    expect(log).toMatch(/parseDayKey\(dayParam\)/);
  });

  it('↻ on the day list re-logs INTO the shown day, not silently onto today', () => {
    // Loose span, not [^)]*: the real call nests parens (`new Date()`).
    expect(index).toMatch(/repeatFoodEntry\([\s\S]{0,120}tsOnDay\(/);
  });
});
