/**
 * Импорт русскоязычной части выгрузки Open Food Facts в компактную локальную
 * базу продуктов.
 *
 * ЗАЧЕМ. Брендовые продукты («Овсяные отруби Мистраль», «Творожок
 * Простоквашино») живут только в OFF, а её публичный API троттлит АНОНИМНЫЕ
 * запросы: со страницы 503 — «not available to anonymous users… registered
 * users are not subject to request limits» (замер 2026-08-22: 5 отказов из 8
 * подряд, ответ за ~280 мс). Наш сервер ходит туда одним IP за всех
 * пользователей, поэтому брендовый поиск зависел от чужого настроения. OFF сама
 * предлагает выход прямо в тексте той же ошибки: «if you're a bot, all our data
 * can be freely downloaded». Этим и пользуемся.
 *
 * ЧТО ЭТО НЕ. Не векторный индекс и не RAG. Задача — лексическая: запрос должен
 * попасть в строку, где буквально есть эти слова, а бренд и жирность обязаны
 * РАЗЛИЧАТЬСЯ, а не «находиться похожими». Эмбеддинги смазывают ровно то
 * различие, ради которого всё делается. Матч остаётся на `ruSearch` (основы,
 * префиксы, одна опечатка) поверх инвертированного индекса.
 *
 * ЛИЦЕНЗИЯ. Данные OFF — под ODbL: производную базу можно распространять с
 * указанием источника и под той же лицензией. Каждая строка отдаётся клиенту с
 * `source: 'openfoodfacts'`, файл кладётся рядом с сервером как артефакт
 * деплоя (в репозиторий не коммитим — он публичный, и это чужая база).
 *
 * ЗАПУСК:
 *   curl -L -o off-products.csv.gz \
 *     https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
 *   npm run import:off -- ./off-products.csv.gz ./off-ru.jsonl
 *
 * Выгрузка стримится через gunzip построчно — распакованные ~9 ГБ на диск не
 * пишутся никогда, память постоянная.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import { energyInconsistent } from '../src/nutrition/energy.js';

/** Колонки выгрузки, которые нам нужны (всего их в файле 211). */
const COLUMNS = [
  'code',
  'product_name',
  'brands',
  'countries_tags',
  'energy-kcal_100g',
  'proteins_100g',
  'fat_100g',
  'carbohydrates_100g',
  'fiber_100g',
  'sugars_100g',
  'saturated-fat_100g',
  'sodium_100g',
] as const;

type Column = (typeof COLUMNS)[number];

/** Строка локальной базы. Ключи короткие — файл читается на каждом старте. */
interface OffRow {
  /** Название продукта как в OFF. */
  n: string;
  /** Бренд отдельно от названия: запрос «отруби овсяные мистраль» должен
   *  находить строку «Овсяные отруби», у которой бренд в своём поле. */
  b?: string;
  k: number;
  p: number;
  f: number;
  c: number;
  fi?: number;
  su?: number;
  sf?: number;
  na?: number;
}

const hasCyrillic = (s: string): boolean => /[а-яё]/i.test(s);

/** Крошево из краудсорса: HTML-сущности, кавычки-ёлочки, двойные пробелы. */
function cleanName(raw: string): string {
  return raw
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;|&gt;/g, ' ')
    .replace(/[«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Правдоподобие строки. Крауд-данные содержат опечатки на порядок («углеводы
 * 900 г»), а такая строка, попав в базу, выдаёт себя за факт. Пропускаем только
 * то, за что можем отвечать: макросы в пределах 100 г на 100 г продукта, сумма
 * не больше 105 (запас на округления и воду), энергия не противоречит макросам
 * по нашей же единой формуле (docs/nutrition-science.md §1).
 */
function plausible(r: { k: number; p: number; f: number; c: number; fi?: number }): boolean {
  const macros = [r.p, r.f, r.c];
  if (macros.some((m) => m < 0 || m > 100)) return false;
  if (r.p + r.f + r.c > 105) return false;
  if (r.k < 0 || r.k > 950) return false;
  if (r.fi !== undefined && (r.fi < 0 || r.fi > r.c + 5)) return false;
  // Ноль по всем макросам и заметная калорийность — строка ни о чём (или вода
  // с ошибкой ввода); ноль везде тоже не еда.
  if (r.k === 0 && r.p === 0 && r.f === 0 && r.c === 0) return false;
  return !energyInconsistent({ kcal: r.k, prot: r.p, fat: r.f, carb: r.c, fiber: r.fi }, { tol: 0.3, absFloor: 60 });
}

/** Ключ дедупликации: одна и та же еда с одинаковым составом из разных штрихкодов. */
function dedupeKey(r: OffRow): string {
  const name = `${r.n} ${r.b ?? ''}`.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
  return `${name}|${Math.round(r.k)}|${Math.round(r.p * 2)}|${Math.round(r.f * 2)}|${Math.round(r.c * 2)}`;
}

async function main(): Promise<void> {
  const [dumpPath, outPath = 'off-ru.jsonl', brandsPath = outPath.replace(/\.jsonl$/, '-brands.txt')] =
    process.argv.slice(2);
  if (!dumpPath) {
    console.error('использование: npm run import:off -- <off-products.csv.gz> [out.jsonl] [brands.txt]');
    process.exit(1);
  }

  const lines = createInterface({
    input: createReadStream(dumpPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const out = createWriteStream(outPath);
  // Бренды собираем со ВСЕХ русских строк, включая 43 тысячи без состава: их
  // числа безнадёжны (проверено — API отдаёт пустой nutriments), но само имя
  // марки — знание. Оно превращает эвристику «слово не из словаря еды, значит
  // уточнение» в точный факт «это марка», см. specificity.ts.
  const brands = new Set<string>();
  const index: Partial<Record<Column, number>> = {};
  const seen = new Set<string>();
  let total = 0;
  let kept = 0;
  let droppedNoName = 0;
  let droppedNoMacros = 0;
  let droppedImplausible = 0;
  let droppedDuplicate = 0;
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
    if (total % 500_000 === 0) console.error(`  …${total.toLocaleString('ru')} строк, отобрано ${kept.toLocaleString('ru')}`);

    const f = line.split('\t');
    const at = (c: Column): string | undefined => f[index[c] as number];

    const name = cleanName(at('product_name') ?? '');
    const brand = cleanName((at('brands') ?? '').split(',')[0] ?? '');
    const countries = at('countries_tags') ?? '';
    // Русскоязычная часть: либо название по-русски (его и будут искать), либо
    // продукт продаётся в России — тогда он полезен даже с латинским именем
    // («Snickers»), потому что пользователь может вписать его как есть.
    const ruRelevant = hasCyrillic(name) || /en:russia/.test(countries);
    if (name.length < 2 || name.length > 120 || !ruRelevant) {
      droppedNoName += 1;
      continue;
    }
    if (brand.length >= 3 && brand.length <= 40) brands.add(brand.toLowerCase());

    const k = num(at('energy-kcal_100g'));
    const p = num(at('proteins_100g'));
    const fat = num(at('fat_100g'));
    const c = num(at('carbohydrates_100g'));
    if (k === undefined || p === undefined || fat === undefined || c === undefined) {
      droppedNoMacros += 1;
      continue;
    }

    const row: OffRow = {
      n: name,
      ...(brand && brand.toLowerCase() !== name.toLowerCase() ? { b: brand.slice(0, 60) } : {}),
      k: Math.round(k),
      p: Math.round(p * 10) / 10,
      f: Math.round(fat * 10) / 10,
      c: Math.round(c * 10) / 10,
    };
    const fiber = num(at('fiber_100g'));
    const sugar = num(at('sugars_100g'));
    const satFat = num(at('saturated-fat_100g'));
    const sodium = num(at('sodium_100g'));
    if (fiber !== undefined) row.fi = Math.round(fiber * 10) / 10;
    if (sugar !== undefined) row.su = Math.round(sugar * 10) / 10;
    if (satFat !== undefined) row.sf = Math.round(satFat * 10) / 10;
    // OFF хранит натрий в граммах — приводим к мг, как в остальном коде.
    if (sodium !== undefined) row.na = Math.round(sodium * 1000);

    if (!plausible(row)) {
      droppedImplausible += 1;
      continue;
    }
    const key = dedupeKey(row);
    if (seen.has(key)) {
      droppedDuplicate += 1;
      continue;
    }
    seen.add(key);
    kept += 1;
    out.write(`${JSON.stringify(row)}\n`);
  }

  await new Promise<void>((resolve) => out.end(resolve));
  const brandList = [...brands].sort();
  await new Promise<void>((resolve) => {
    const bs = createWriteStream(brandsPath);
    bs.write(brandList.join('\n'));
    bs.end(resolve);
  });
  console.error(
    [
      '',
      `прочитано строк:      ${total.toLocaleString('ru')}`,
      `отобрано:             ${kept.toLocaleString('ru')} → ${outPath}`,
      `марок:                ${brandList.length.toLocaleString('ru')} → ${brandsPath}`,
      `отброшено:`,
      `  не про RU / без имени   ${droppedNoName.toLocaleString('ru')}`,
      `  без полного БЖУ         ${droppedNoMacros.toLocaleString('ru')}`,
      `  неправдоподобные        ${droppedImplausible.toLocaleString('ru')}`,
      `  дубликаты состава       ${droppedDuplicate.toLocaleString('ru')}`,
    ].join('\n'),
  );
}

await main();
