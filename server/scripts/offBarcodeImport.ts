/**
 * Индекс «штрихкод → состав» из выгрузки Open Food Facts.
 *
 * Отдельно от `offRuImport.ts`, потому что это принципиально другой срез: там —
 * русские продукты для поиска ПО НАЗВАНИЮ, здесь — ВЕСЬ мир по коду. Замер по
 * выгрузке 22.08.2026: полный состав есть у 2 197 807 продуктов, валидный EAN —
 * у 2 150 146 из них, и лишь 6 664 русские. То есть по штрихкоду выигрыш кратно
 * больше, чем по названию: это все привозные и импортные пачки, которые
 * по-русски не ищутся никак.
 *
 * Результат — два файла (~52 МБ записей + ~64 МБ имён), см. формат в
 * `src/nutrition/barcodeIndex.ts`. Читаются двоичным поиском прямо с диска, в
 * память ничего не грузится.
 *
 * ЗАПУСК:  npm run import:barcodes -- ./off-products.csv.gz ./off-barcodes
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import { BARCODE_FIBER_ABSENT, BARCODE_RECORD_BYTES, validEan } from '../src/nutrition/barcodeIndex.js';
import { energyInconsistent } from '../src/nutrition/energy.js';

const COLUMNS = [
  'code',
  'product_name',
  'brands',
  'energy-kcal_100g',
  'proteins_100g',
  'fat_100g',
  'carbohydrates_100g',
  'fiber_100g',
] as const;
type Column = (typeof COLUMNS)[number];

/** Длиннее этого имя продукта не несёт информации, только вес файла. */
const MAX_NAME_BYTES = 70;

interface Row {
  code: bigint;
  kcal: number;
  prot: number;
  fat: number;
  carb: number;
  fiber: number;
  name: string;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** ×10 в uint16 с обрезкой по границам поля. */
const fixed = (v: number): number => Math.max(0, Math.min(65534, Math.round(v * 10)));

async function main(): Promise<void> {
  const [dumpPath, outPrefix = 'off-barcodes'] = process.argv.slice(2);
  if (!dumpPath) {
    console.error('использование: npm run import:barcodes -- <off-products.csv.gz> [префикс]');
    process.exit(1);
  }

  const lines = createInterface({
    input: createReadStream(dumpPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const index: Partial<{ [K in Column]: number }> = {};
  const records: Row[] = [];
  const seen = new Set<string>();
  let total = 0;
  let noMacros = 0;
  let badEan = 0;
  let implausible = 0;
  let duplicate = 0;
  let header = true;

  for await (const line of lines) {
    if (header) {
      const cols = line.split('\t');
      for (const c of COLUMNS) {
        const at = cols.indexOf(c);
        if (at < 0) throw new Error(`в выгрузке нет колонки ${c} — формат OFF изменился`);
        index[c] = at;
      }
      header = false;
      continue;
    }
    total += 1;
    if (total % 1_000_000 === 0) {
      console.error(`  …${total.toLocaleString('ru')} строк, отобрано ${records.length.toLocaleString('ru')}`);
    }

    const f = line.split('\t');
    const at = (c: Column): string | undefined => f[index[c] as number];

    const kcal = num(at('energy-kcal_100g'));
    const prot = num(at('proteins_100g'));
    const fat = num(at('fat_100g'));
    const carb = num(at('carbohydrates_100g'));
    if (kcal === undefined || prot === undefined || fat === undefined || carb === undefined) {
      noMacros += 1;
      continue;
    }

    const code = (at('code') ?? '').replace(/["\s]/g, '');
    if (!validEan(code)) {
      badEan += 1;
      continue;
    }

    const fiber = num(at('fiber_100g'));
    // Те же проверки правдоподобия, что и у поиска по названию: строка с
    // «углеводы 900» не должна попасть в базу и выдать себя за факт.
    if (
      prot < 0 || fat < 0 || carb < 0 ||
      prot > 100 || fat > 100 || carb > 100 ||
      prot + fat + carb > 105 ||
      kcal < 0 || kcal > 950 ||
      (kcal === 0 && prot === 0 && fat === 0 && carb === 0) ||
      energyInconsistent({ kcal, prot, fat, carb, fiber }, { tol: 0.3, absFloor: 60 })
    ) {
      implausible += 1;
      continue;
    }

    if (seen.has(code)) {
      duplicate += 1;
      continue;
    }
    seen.add(code);

    // Имя + бренд, если бренда в имени ещё нет: карточка должна называться так,
    // как продукт выглядит на полке.
    const rawName = (at('product_name') ?? '').replace(/\s+/g, ' ').trim();
    const brand = ((at('brands') ?? '').split(',')[0] ?? '').replace(/\s+/g, ' ').trim();
    const withBrand =
      brand && !rawName.toLowerCase().includes(brand.toLowerCase()) ? `${rawName} ${brand}` : rawName;
    let name = (withBrand || rawName).trim();
    // Обрезаем по БАЙТАМ, не по символам: кириллица — два байта, и обрезка по
    // символам могла бы разъехаться с длиной, записанной в индексе.
    while (Buffer.byteLength(name, 'utf8') > MAX_NAME_BYTES) name = name.slice(0, -1);

    records.push({
      code: BigInt(code),
      kcal: Math.round(kcal),
      prot: fixed(prot),
      fat: fixed(fat),
      carb: fixed(carb),
      fiber: fiber === undefined ? BARCODE_FIBER_ABSENT : fixed(fiber),
      name,
    });
  }

  console.error(`сортировка ${records.length.toLocaleString('ru')} записей…`);
  records.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const bin = Buffer.allocUnsafe(records.length * BARCODE_RECORD_BYTES);
  const names: Buffer[] = [];
  let nameOffset = 0;
  for (const [i, r] of records.entries()) {
    const nameBuf = Buffer.from(r.name, 'utf8');
    names.push(nameBuf);
    const at = i * BARCODE_RECORD_BYTES;
    bin.writeBigUInt64LE(r.code, at);
    bin.writeUInt16LE(Math.min(65535, r.kcal), at + 8);
    bin.writeUInt16LE(r.prot, at + 10);
    bin.writeUInt16LE(r.fat, at + 12);
    bin.writeUInt16LE(r.carb, at + 14);
    bin.writeUInt16LE(r.fiber, at + 16);
    bin.writeUInt32LE(nameOffset, at + 18);
    bin.writeUInt16LE(nameBuf.length, at + 22);
    nameOffset += nameBuf.length;
  }

  writeFileSync(`${outPrefix}.bin`, bin);
  writeFileSync(`${outPrefix}.names`, Buffer.concat(names));

  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} МБ`;
  console.error(
    [
      '',
      `прочитано строк:      ${total.toLocaleString('ru')}`,
      `в индексе:            ${records.length.toLocaleString('ru')}`,
      `  ${outPrefix}.bin     ${mb(bin.length)}`,
      `  ${outPrefix}.names   ${mb(nameOffset)}`,
      `отброшено:`,
      `  без полного БЖУ         ${noMacros.toLocaleString('ru')}`,
      `  без валидного EAN       ${badEan.toLocaleString('ru')}`,
      `  неправдоподобные        ${implausible.toLocaleString('ru')}`,
      `  повторы кода            ${duplicate.toLocaleString('ru')}`,
    ].join('\n'),
  );
}

await main();
