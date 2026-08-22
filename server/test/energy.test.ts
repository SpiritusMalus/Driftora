import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CURATED_RU } from '../src/nutrition/curatedRu.js';
import { energyFromMacros, energyInconsistent } from '../src/nutrition/energy.js';

// ---- the formula ------------------------------------------------------------

test('energyFromMacros: general Atwater on plain macros', () => {
  assert.equal(energyFromMacros({ prot: 10, fat: 10, carb: 10 }), 170); // 40 + 90 + 40
  assert.equal(energyFromMacros({ prot: 0, fat: 0, carb: 0 }), 0);
});

test('energyFromMacros: fiber billed at 2 kcal/g, carved out of total carb', () => {
  // 30 g carb of which 10 g fiber → 20·4 + 10·2 = 100 (naïve 4·30 would be 120).
  assert.equal(energyFromMacros({ prot: 0, fat: 0, carb: 30, fiber: 10 }), 100);
  // All-fiber carbohydrate → 2 kcal/g only.
  assert.equal(energyFromMacros({ prot: 0, fat: 0, carb: 10, fiber: 10 }), 20);
  // Fiber reported above total carb never drives available carb negative.
  assert.equal(energyFromMacros({ prot: 0, fat: 0, carb: 5, fiber: 10 }), 20);
});

test('energyFromMacros: polyols 2.4, erythritol 0, both carved out of carb', () => {
  assert.equal(energyFromMacros({ prot: 0, fat: 0, carb: 10, polyol: 10 }), 24);
  assert.equal(energyFromMacros({ prot: 0, fat: 0, carb: 10, erythritol: 10 }), 0);
});

test('energyFromMacros: negatives / NaN clamp to 0, never inflate', () => {
  assert.equal(energyFromMacros({ prot: -5, fat: NaN as unknown as number, carb: 10 }), 40);
});

test('energyInconsistent: consistent pairs pass, gross mismatches fail', () => {
  assert.equal(energyInconsistent({ kcal: 170, prot: 10, fat: 10, carb: 10 }), false);
  // A per-serving kcal left against per-100g macros, or an OCR/transposition slip.
  assert.equal(energyInconsistent({ kcal: 250, prot: 5, fat: 2, carb: 15 }), true);
  // Small-food rounding (20 stated vs 12 computed = 8 kcal) never trips the floor.
  assert.equal(energyInconsistent({ kcal: 20, prot: 0, fat: 0, carb: 3 }), false);
});

// ---- the ruler --------------------------------------------------------------
// Runs the ONE formula over the curated RU corpus and reports how well it
// reproduces each row's own stated kcal. This is the measurement baseline for
// every energy change (docs/nutrition-science.md §0): a shifted distribution
// later means the formula or the corpus moved, and the worst offenders are
// curated rows whose kcal doesn't reconcile with their macros — a data-quality
// lead for task #5, not a formula bug.

test('ruler: the single formula reproduces curated RU kcal', () => {
  const rows = CURATED_RU.map((e) => {
    const stated = e.per100.kcal;
    const computed = energyFromMacros(e.per100);
    const pct = stated > 0 ? Math.abs(computed - stated) / stated : 0;
    return { name: e.name, stated, computed: Math.round(computed), pct };
  });
  const pcts = rows.map((r) => r.pct).sort((a, b) => a - b);
  // `pcts` is non-empty because CURATED_RU is, but an index is still an index —
  // handle it once here rather than at each of the four call sites.
  const at = (q: number): number => pcts[Math.min(pcts.length - 1, Math.floor(pcts.length * q))] ?? 0;
  const median = at(0.5);
  const p90 = at(0.9);
  const mape = pcts.reduce((s, x) => s + x, 0) / pcts.length;
  const within15 = pcts.filter((x) => x <= 0.15).length / pcts.length;
  const worst = [...rows].sort((a, b) => b.pct - a.pct).slice(0, 8);

  console.log(
    `[energy ruler] n=${rows.length} median=${(median * 100).toFixed(1)}% ` +
      `p90=${(p90 * 100).toFixed(1)}% MAPE=${(mape * 100).toFixed(1)}% within15%=${(within15 * 100).toFixed(0)}%`,
  );
  console.log(
    '[energy ruler] worst: ' +
      worst.map((w) => `${w.name} ${w.stated}→${w.computed} (${(w.pct * 100).toFixed(0)}%)`).join(' · '),
  );

  // Deterministic, non-absurd for every row.
  for (const r of rows) assert.ok(Number.isFinite(r.computed) && r.computed >= 0);
  // Guard calibrated to the measured distribution (median 1.2%, 94% within 15%
  // at n=47) with headroom. The tail is dominated by high-fiber soups (щи,
  // фасолевый/гороховый суп) the naïve carb·4 overcounts for lack of a fiber
  // value — expected, and exactly what task #5 (fiber) addresses. We do NOT
  // overwrite curated kcal; this only proves the formula tracks it.
  assert.ok(median <= 0.06, `median gap ${(median * 100).toFixed(1)}% exceeds 6%`);
  assert.ok(within15 >= 0.85, `only ${(within15 * 100).toFixed(0)}% within 15%`);
});

// --- ГЕЙТ ДАННЫХ: каждая курируемая строка сходится с единой формулой ---------
// Ловит ошибку, которую иначе видит только пользователь с пачкой в руках: я сам
// внёс овсяные отруби с измеренным USDA-числом (246 при формульных 366) —
// расхождение на треть внутри таблицы, построенной на одной формуле
// (docs/nutrition-science.md §1). Порог тот же, что у energyInconsistent: гейт
// ловит грубое расхождение, а не пару процентов округления.
test('CURATED_RU: kcal каждой строки согласован с единой формулой', async () => {
  const { CURATED_RU } = await import('../src/nutrition/curatedRu.js');
  const off = CURATED_RU.filter((row) => energyInconsistent({ kcal: row.per100.kcal, ...row.per100 })).map(
    (row) => `${row.name}: указано ${row.per100.kcal}, по формуле ${Math.round(energyFromMacros(row.per100))}`,
  );
  assert.deepEqual(off, [], `строки расходятся с формулой:\n${off.join('\n')}`);
});
