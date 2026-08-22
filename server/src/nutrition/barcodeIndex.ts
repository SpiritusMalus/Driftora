import { closeSync, openSync, readSync, statSync } from 'node:fs';

import type { Minerals, Per100 } from '../types.js';

/**
 * ПОИСК ПРОДУКТА ПО ШТРИХКОДУ — офлайн, по двоичному файлу на диске.
 *
 * Штрихкод — идеальный ключ: он точный, не зависит от языка, падежей и опечаток,
 * и сам себя проверяет (контрольная цифра EAN-13). Поэтому здесь нет ни
 * нечёткого сравнения, ни ранжирования — только двоичный поиск по
 * отсортированному файлу.
 *
 * ПОЧЕМУ НЕ В ПАМЯТИ. Продуктов с полным составом и валидным EAN во всём мире
 * 2 150 146 (замер по выгрузке 22.08.2026) — это ~52 МБ записей плюс ~64 МБ имён.
 * Держать это в куче на VPS с 4.9 ГБ памяти незачем: двоичный поиск по
 * отсортированному файлу — это ~21 чтение по 24 байта, страницы оседают в
 * кеше ОС, а наша куча не растёт вообще. Ноль зависимостей, ноль SQLite.
 *
 * ЗАПИСЬ БЕЗ СОСТАВА — ТОЖЕ ЗНАНИЕ. У 2.3 млн товаров в выгрузке есть имя и
 * марка, но нет БЖУ (человек отсканировал упаковку и не заполнил состав). Такие
 * записи мы храним ТОЖЕ: код всё равно опознаёт товар, а состав по названию
 * найдёт обычная цепочка источников. Просить человека доснять этикетку значит
 * перекладывать на него нашу работу (владелец, 2026-08-22) — поэтому отсутствие
 * состава помечается отдельным значением, и вызывающий код идёт искать по имени
 * сам, ничего не спрашивая.
 *
 * ФОРМАТ (записи по 24 байта, отсортированы по коду):
 *   0..7   код EAN как uint64 LE (13 цифр < 2^44, влезает с запасом)
 *   8..9   ккал                       uint16 (0xFFFF = состава нет; 0 — законный)
 *   10..11 белки  ×10                 uint16
 *   12..13 жиры   ×10                 uint16
 *   14..15 углеводы ×10               uint16
 *   16..17 клетчатка ×10              uint16 (0xFFFF = поля нет)
 *   18..21 смещение имени             uint32  → в файле .names
 *   22..23 длина имени в байтах       uint16
 *
 * Файлы готовит `scripts/offBarcodeImport.ts`; это артефакт деплоя (данные OFF
 * под ODbL, репозиторий публичный) — см. docs/off-snapshot.md.
 */

const RECORD_BYTES = 24;
const FIBER_ABSENT = 0xffff;
/**
 * Метка «состава в выгрузке не было» в поле ккал. Это ИМЕННО метка, а не ноль:
 * ноль калорий — законный состав (вода, «Кока-кола Зеро», чёрный кофе), и если
 * бы отсутствие обозначалось нулями, весь класс диетических напитков считался
 * бы по составу их сахарных тёзок. Настоящая калорийность не превышает 950, так
 * что 65535 свободно.
 */
const COMPOSITION_ABSENT = 0xffff;

export interface BarcodeHit {
  name: string;
  /** Состав, если он в выгрузке был. Иначе null — товар опознан, но числа
   *  придётся искать по названию (это делает вызывающий код, не пользователь). */
  per100: Per100 | null;
}

/**
 * Контрольная цифра EAN-13/EAN-8. Именно она отличает штрихкод от любого другого
 * ввода: искажённое считывание почти всегда ломает контрольную сумму, поэтому
 * до базы доходит либо верный код, либо ничего. Проверяем и у себя тоже — код
 * может прийти не от декодера, а из текстового поля.
 */
export function validEan(code: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop() as number;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export class BarcodeIndex {
  private constructor(
    private readonly fd: number,
    private readonly namesFd: number,
    readonly size: number,
  ) {}

  static open(binPath: string, namesPath: string): BarcodeIndex {
    const fd = openSync(binPath, 'r');
    const bytes = statSync(binPath).size;
    if (bytes % RECORD_BYTES !== 0) {
      closeSync(fd);
      throw new Error(`${binPath}: размер ${bytes} не кратен ${RECORD_BYTES} — файл битый`);
    }
    return new BarcodeIndex(fd, openSync(namesPath, 'r'), bytes / RECORD_BYTES);
  }

  close(): void {
    closeSync(this.fd);
    closeSync(this.namesFd);
  }

  /** Код записи под номером `at`. */
  private codeAt(at: number, buf: Buffer): bigint {
    readSync(this.fd, buf, 0, RECORD_BYTES, at * RECORD_BYTES);
    return buf.readBigUInt64LE(0);
  }

  /** Товар по штрихкоду, или null. Контрольная цифра проверяется до поиска. */
  lookup(code: string): BarcodeHit | null {
    const trimmed = code.trim();
    if (!validEan(trimmed)) return null;
    const wanted = BigInt(trimmed);
    const buf = Buffer.allocUnsafe(RECORD_BYTES);

    let lo = 0;
    let hi = this.size - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const got = this.codeAt(mid, buf);
      if (got === wanted) return this.read(buf);
      if (got < wanted) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  /** Разбор найденной записи (буфер уже содержит её байты). */
  private read(buf: Buffer): BarcodeHit {
    const dec = (offset: number): number => buf.readUInt16LE(offset) / 10;
    const fiberRaw = buf.readUInt16LE(16);
    const nameOffset = buf.readUInt32LE(18);
    const nameLength = buf.readUInt16LE(22);

    const nameBuf = Buffer.allocUnsafe(nameLength);
    readSync(this.namesFd, nameBuf, 0, nameLength, nameOffset);

    const kcal = buf.readUInt16LE(8);
    const prot = dec(10);
    const fat = dec(12);
    const carb = dec(14);
    const hasComposition = kcal !== COMPOSITION_ABSENT;
    const minerals: Minerals = {};
    const per100: Per100 | null = hasComposition
      ? {
          source: 'openfoodfacts',
          kcal,
          prot,
          fat,
          carb,
          ...(fiberRaw === FIBER_ABSENT ? {} : { fiber: fiberRaw / 10 }),
          minerals,
        }
      : null;
    return { name: nameBuf.toString('utf8'), per100 };
  }
}

/** Ширина записи — нужна импортёру, чтобы писать тот же формат. */
export const BARCODE_RECORD_BYTES = RECORD_BYTES;
export const BARCODE_FIBER_ABSENT = FIBER_ABSENT;
export const BARCODE_COMPOSITION_ABSENT = COMPOSITION_ABSENT;
