/**
 * Generate `src/nutrition/skurikhinData.ts` from the USDA SR Legacy bulk
 * download (public domain). NO numbers are hand-written — every value is read
 * from SR Legacy, so the table is sourced + verifiable, never fabricated. Foods
 * in `ruFoodList.ts` with no good SR match are omitted (honest `estimate`
 * fallback covers them).
 *
 * Usage:
 *   1. Download + unzip the SR Legacy CSV bundle:
 *      https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
 *   2. SR_DIR=/path/to/FoodData_Central_sr_legacy_food_csv_2018-04 \
 *        npm run import:nutrition
 *
 * Data: U.S. Department of Agriculture, Agricultural Research Service. FoodData
 * Central, Standard Reference Legacy (2018). fdc.nal.usda.gov. Public domain.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RU_FOODS, type RuFood } from './ruFoodList.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SR_DIR = process.env.SR_DIR;
const OUT = join(HERE, '..', 'src', 'nutrition', 'skurikhinData.ts');

// SR Legacy nutrient ids (== nutrient_id in food_nutrient.csv).
const NUT = { kcal: 1008, prot: 1003, fat: 1004, carb: 1005, na: 1093, k: 1092, ca: 1087, mg: 1090, fe: 1089, zn: 1095 };
const KCAL_FALLBACK = [2048, 2047]; // Atwater energy if 1008 is absent
const MINERAL_KEYS = ['na', 'k', 'ca', 'mg', 'fe', 'zn'] as const;

// Vitamin nutrient ids (units as SR Legacy reports them: µg A/D/B9/B12, mg
// E/C/B1/B2/B6) — same ids the live USDA client reads, so the two stay aligned.
const VIT = {
  a: 1106, // Vitamin A, RAE (µg)
  d: 1114, // Vitamin D (D2 + D3) (µg)
  e: 1109, // Vitamin E (alpha-tocopherol) (mg)
  c: 1162, // Vitamin C, total ascorbic acid (mg)
  b1: 1165, // Thiamin (mg)
  b2: 1166, // Riboflavin (mg)
  b6: 1175, // Vitamin B-6 (mg)
  b9: 1190, // Folate, DFE (µg)
  b12: 1178, // Vitamin B-12 (µg)
} as const;
const VITAMIN_KEYS = ['a', 'd', 'e', 'c', 'b1', 'b2', 'b6', 'b9', 'b12'] as const;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!SR_DIR) {
  fail('Set SR_DIR to the unzipped SR Legacy CSV folder (see this file\'s header).');
}

/** Parse one CSV line into fields (handles quotes + commas + "" escapes). */
function parseCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const round1 = (n: number): number => Math.round(n * 10) / 10;

interface Food { id: string; desc: string; words: Set<string> }

// 1) Foods.
const foods: Food[] = [];
const byId = new Map<string, Food>();
{
  const lines = readFileSync(join(SR_DIR!, 'food.csv'), 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]!.trim()) continue;
    const f = parseCsv(lines[i]!);
    const id = f[0]!;
    const desc = f[2] ?? '';
    const food: Food = { id, desc, words: new Set(norm(desc).split(' ')) };
    foods.push(food);
    byId.set(id, food);
  }
}

/** Pick the SR food for a RU entry: exact pin, else all query-words present. */
function match(food: RuFood): Food | null {
  if (food.fdcId) return byId.get(String(food.fdcId)) ?? null;
  const q = norm(food.query).split(' ').filter(Boolean);
  let cands = foods.filter((f) => q.every((w) => f.words.has(w)));
  if (food.prefer) {
    const p = norm(food.prefer).split(' ').filter(Boolean);
    const narrowed = cands.filter((f) => p.every((w) => f.words.has(w)));
    if (narrowed.length) cands = narrowed;
  }
  // Prefer the most basic (shortest) description; tiebreak by lowest fdc id.
  cands.sort((a, b) => a.desc.length - b.desc.length || Number(a.id) - Number(b.id));
  return cands[0] ?? null;
}

const targets = new Map<string, RuFood>(); // fdc_id → RU food
const misses: string[] = [];
for (const food of RU_FOODS) {
  const m = match(food);
  if (m && !targets.has(m.id)) targets.set(m.id, food);
  else if (!m) misses.push(food.name);
}

// 2) Nutrient amounts for the matched fdc ids (stream the big file).
const wanted = new Set<number>([...Object.values(NUT), ...Object.values(VIT), ...KCAL_FALLBACK]);
const amounts = new Map<string, Map<number, number>>(); // fdc_id → nutrient_id → amount
{
  const data = readFileSync(join(SR_DIR!, 'food_nutrient.csv'), 'utf8');
  let nl = data.indexOf('\n');
  let start = nl + 1; // skip header
  while (start < data.length) {
    nl = data.indexOf('\n', start);
    const end = nl === -1 ? data.length : nl;
    const line = data.slice(start, end);
    start = end + 1;
    // First four fields are bare numbers → cheap split is safe.
    const c = line.split(',');
    const fdc = c[1]?.replace(/"/g, '');
    if (!fdc || !targets.has(fdc)) continue;
    const nid = Number(c[2]?.replace(/"/g, ''));
    if (!wanted.has(nid)) continue;
    const amt = Number(c[3]?.replace(/"/g, ''));
    if (!Number.isFinite(amt)) continue;
    let m = amounts.get(fdc);
    if (!m) { m = new Map(); amounts.set(fdc, m); }
    m.set(nid, amt);
  }
}

// 3) Build entries.
interface OutEntry { name: string; aliases: string[]; per100: Record<string, unknown> }
const entries: OutEntry[] = [];
const log: string[] = [];
for (const [fdc, food] of targets) {
  const a = amounts.get(fdc);
  if (!a) { misses.push(`${food.name} (no nutrients)`); continue; }
  const kcal = a.get(NUT.kcal) ?? a.get(KCAL_FALLBACK[0]!) ?? a.get(KCAL_FALLBACK[1]!) ?? 0;
  const prot = a.get(NUT.prot) ?? 0;
  if (kcal === 0 && prot === 0) { misses.push(`${food.name} (empty)`); continue; }
  const minerals: Record<string, number> = {};
  for (const k of MINERAL_KEYS) {
    const v = a.get(NUT[k]);
    // Keep 1 decimal so small minerals (Fe/Zn, often <10 mg) aren't lost to 0.
    if (typeof v === 'number' && round1(v) > 0) minerals[k] = round1(v);
  }
  const vitamins: Record<string, number> = {};
  for (const k of VITAMIN_KEYS) {
    const v = a.get(VIT[k]);
    // 2 decimals so sub-mg vitamins (thiamin, B12 in µg) aren't lost to 0.
    if (typeof v === 'number' && round2(v) > 0) vitamins[k] = round2(v);
  }
  entries.push({
    name: food.name,
    aliases: food.aliases,
    per100: {
      kcal: Math.round(kcal),
      prot: round1(prot),
      fat: round1(a.get(NUT.fat) ?? 0),
      carb: round1(a.get(NUT.carb) ?? 0),
      minerals,
      ...(Object.keys(vitamins).length > 0 ? { vitamins } : {}),
    },
  });
  log.push(`  ${food.name.padEnd(28)} ← [${fdc}] ${byId.get(fdc)!.desc}  (${Math.round(kcal)} kcal)`);
}
entries.sort((x, y) => x.name.localeCompare(y.name, 'ru'));

// 4) Emit the generated module.
const mineralStr = (m: Record<string, unknown>): string =>
  `{ ${MINERAL_KEYS.filter((k) => k in m).map((k) => `${k}: ${m[k]}`).join(', ')} }`;
const vitaminStr = (v: Record<string, unknown>): string =>
  `{ ${VITAMIN_KEYS.filter((k) => k in v).map((k) => `${k}: ${v[k]}`).join(', ')} }`;
const body = entries
  .map((e) => {
    const p = e.per100 as {
      kcal: number;
      prot: number;
      fat: number;
      carb: number;
      minerals: Record<string, unknown>;
      vitamins?: Record<string, unknown>;
    };
    const aliases = e.aliases.map((x) => `'${x.replace(/'/g, "\\'")}'`).join(', ');
    const vit = p.vitamins && Object.keys(p.vitamins).length > 0 ? `, vitamins: ${vitaminStr(p.vitamins)}` : '';
    return `  { name: '${e.name.replace(/'/g, "\\'")}', aliases: [${aliases}], source: 'usda',\n    per100: { kcal: ${p.kcal}, prot: ${p.prot}, fat: ${p.fat}, carb: ${p.carb}, minerals: ${mineralStr(p.minerals)}${vit} } },`;
  })
  .join('\n');

const out = `// AUTO-GENERATED by scripts/srLegacyImport.ts — DO NOT EDIT BY HAND.
// Regenerate: SR_DIR=/path/to/sr_legacy npm run import:nutrition
//
// Source: U.S. Department of Agriculture, Agricultural Research Service.
// FoodData Central, Standard Reference Legacy (2018). https://fdc.nal.usda.gov
// Public domain. Per-100g values; source attributed as 'usda' per entry.
//
// ${entries.length} foods imported. RU items absent from USDA (ряженка, сырок,
// etc.) are intentionally omitted → the resolver's flagged 'estimate' fallback
// covers them. Drop in a digitized Skurikhin dataset to extend RU coverage.
import type { SkurikhinEntry } from './skurikhinTypes.js';

export const SKURIKHIN_TABLE: SkurikhinEntry[] = [
${body}
];
`;

writeFileSync(OUT, out, 'utf8');
console.error(`\nImported ${entries.length}/${RU_FOODS.length} foods → ${OUT}`);
console.error(log.join('\n'));
if (misses.length) console.error(`\nOmitted (no SR match → estimate fallback): ${misses.join(', ')}`);
