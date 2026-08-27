import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { BARCODE_FIBER_ABSENT, BARCODE_RECORD_BYTES, BarcodeIndex, normalizeGtin, validEan } from '../src/nutrition/barcodeIndex.js';

/// Штрихкод — точный ключ, а не имя: ни падежей, ни языка, ни опечаток. Плюс он
/// сам себя проверяет контрольной цифрой, поэтому искажённое считывание должно
/// отбрасываться, а не превращаться в чужой продукт.

test('validEan: контрольная цифра ловит подмену цифры', () => {
  assert.equal(validEan('5449000000996'), true); // Coca-Cola, реальный код
  assert.equal(validEan('4600823143005'), true); // Бабаевский горький
  assert.equal(validEan('5449000000997'), false); // испорчена контрольная
  assert.equal(validEan('5449000009960'), false); // переставлены цифры
  assert.equal(validEan('544900000099'), false); // не та длина
  assert.equal(validEan('abcdefghijklm'), false);
});

test('normalizeGtin: EAN-8/EAN-13 проходят как есть, мусор и битая контрольная — null', () => {
  assert.equal(normalizeGtin('5449000000996'), '5449000000996'); // EAN-13 как есть
  assert.equal(normalizeGtin('96385074'), '96385074'); // EAN-8 как есть
  assert.equal(normalizeGtin('5449000000997'), null); // битая контрольная
  assert.equal(normalizeGtin('544900000099'), null); // 12 цифр с чужой контрольной — не UPC-A
  assert.equal(normalizeGtin('abcdefghijklm'), null);
  assert.equal(normalizeGtin(''), null);
});

test('normalizeGtin: UPC-A и UPC-E разворачиваются в EAN-13 (device report 2026-08-26)', () => {
  // Сканер отдаёт UPC-A 12 цифрами — раньше сервер молча браковал его как
  // invalid_code. Нулевой префикс не меняет контрольную цифру GS1.
  assert.equal(normalizeGtin('036000291452'), '0036000291452');
  // UPC-E: контрольная цифра считается от РАЗВЁРНУТОГО UPC-A. 8 цифр,
  // проходящие как EAN-8, остаются EAN-8 (для RU это правильный приоритет,
  // и для случая сжатия x6≥5 контрольные суммы совпадают алгебраически);
  // разворот пробуется, только когда EAN-8-контрольная не сходится.
  assert.equal(normalizeGtin('01234505'), '0012000003455');
  assert.equal(normalizeGtin('01234565'), '01234565'); // валидный EAN-8 — как есть
});

test('normalizeGtin: ITF-14 с коробки разворачивается в код вложенной единицы', () => {
  // «Вертикальный, необычный» код мультипака (жирные полосы в рамке).
  // Индикатор 0 = тот же EAN-13; индикатор ≥1 = код вложенной единицы:
  // индикатор отбрасывается, контрольная пересчитывается (правило GS1).
  assert.equal(normalizeGtin('05449000000996'), '5449000000996');
  assert.equal(normalizeGtin('15901234123454'), '5901234123457');
  assert.equal(normalizeGtin('15901234123455'), null); // битая контрольная GTIN-14
});

/** Собирает индекс из пар «код → продукт» тем же форматом, что и импортёр. */
function indexOf(rows: { code: string; name: string; kcal: number; fiber?: number }[]): BarcodeIndex {
  const sorted = [...rows].sort((a, b) => (BigInt(a.code) < BigInt(b.code) ? -1 : 1));
  const bin = Buffer.alloc(sorted.length * BARCODE_RECORD_BYTES);
  const names: Buffer[] = [];
  let offset = 0;
  sorted.forEach((r, i) => {
    const nameBuf = Buffer.from(r.name, 'utf8');
    names.push(nameBuf);
    const at = i * BARCODE_RECORD_BYTES;
    bin.writeBigUInt64LE(BigInt(r.code), at);
    bin.writeUInt16LE(r.kcal, at + 8);
    bin.writeUInt16LE(10, at + 10);
    bin.writeUInt16LE(20, at + 12);
    bin.writeUInt16LE(30, at + 14);
    bin.writeUInt16LE(r.fiber === undefined ? BARCODE_FIBER_ABSENT : r.fiber * 10, at + 16);
    bin.writeUInt32LE(offset, at + 18);
    bin.writeUInt16LE(nameBuf.length, at + 22);
    offset += nameBuf.length;
  });
  const dir = mkdtempSync(join(tmpdir(), 'barcodes-'));
  writeFileSync(join(dir, 'i.bin'), bin);
  writeFileSync(join(dir, 'i.names'), Buffer.concat(names));
  return BarcodeIndex.open(join(dir, 'i.bin'), join(dir, 'i.names'));
}

const rows = [
  { code: '5449000000996', name: 'Coca-Cola', kcal: 42 },
  { code: '4600823143005', name: 'Бабаевский горький', kcal: 540, fiber: 7.5 },
  { code: '0640245432480', name: 'Простоквашино Йогурт с клубникой', kcal: 92 },
];

test('двоичный поиск находит каждую запись и не находит отсутствующую', () => {
  const idx = indexOf(rows);
  try {
    for (const r of rows) {
      const hit = idx.lookup(r.code);
      assert.equal(hit?.name, r.name, `код ${r.code}`);
      // `per100` в выгрузке бывает пустым — у этих строк он есть, и без явной
      // проверки промах читался бы как падение по kcal, а не как «состава нет».
      assert.ok(hit?.per100, `код ${r.code}: состав обязан доехать`);
      assert.equal(hit.per100.kcal, r.kcal);
      assert.equal(hit.per100.source, 'openfoodfacts', 'происхождение остаётся честным');
    }
    assert.equal(idx.lookup('4607036800014'), null, 'валидный, но отсутствующий код');
  } finally {
    idx.close();
  }
});

test('искажённый код до базы не доходит (контрольная цифра)', () => {
  const idx = indexOf(rows);
  try {
    // Одна цифра испорчена: продукт существует, но код уже не тот — и мы обязаны
    // вернуть НИЧЕГО, а не соседний товар.
    assert.equal(idx.lookup('5449000000997'), null);
    assert.equal(idx.lookup('  '), null);
  } finally {
    idx.close();
  }
});

test('клетчатка: отсутствие поля отличается от нуля', () => {
  const idx = indexOf(rows);
  try {
    const withFiber = idx.lookup('4600823143005');
    assert.ok(withFiber?.per100);
    assert.equal(withFiber.per100.fiber, 7.5);

    const noFiber = idx.lookup('5449000000996');
    assert.ok(noFiber?.per100);
    assert.equal(noFiber.per100.fiber, undefined, 'поля нет — не выдумываем ноль');
  } finally {
    idx.close();
  }
});

test('битый по размеру файл честно отвергается', () => {
  const dir = mkdtempSync(join(tmpdir(), 'barcodes-bad-'));
  writeFileSync(join(dir, 'i.bin'), Buffer.alloc(BARCODE_RECORD_BYTES + 5));
  writeFileSync(join(dir, 'i.names'), Buffer.alloc(0));
  assert.throws(() => BarcodeIndex.open(join(dir, 'i.bin'), join(dir, 'i.names')), /битый/);
});
