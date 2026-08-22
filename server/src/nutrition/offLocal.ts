import { readFileSync } from 'node:fs';

import type { Minerals, Per100, Region } from '../types.js';
import type { BarcodeIndex } from './barcodeIndex.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { phraseScore, stemRu } from './ruSearch.js';
import { normalizeName } from './scoring.js';

/**
 * ЛОКАЛЬНАЯ КОПИЯ БРЕНДОВОЙ ЧАСТИ OPEN FOOD FACTS.
 *
 * Брендовые продукты («Овсяные отруби Мистраль», «Творожок Простоквашино») есть
 * только в OFF, но её публичный API троттлит анонимные запросы — со страницы
 * 503: «not available to anonymous users… registered users are not subject to
 * request limits» (замер 2026-08-22: 5 отказов из 8 подряд). Один серверный IP
 * ходит туда за всех, поэтому попадание в бренд зависело от чужой нагрузки.
 * Здесь та же самая база лежит рядом с сервером: ноль сетевых вызовов, ответ за
 * доли миллисекунды, и 503 больше ни на что не влияет. Файл готовит
 * `scripts/offRuImport.ts` (6 377 строк на 22.08.2026 — столько в выгрузке
 * русских продуктов с ПОЛНЫМ составом; ещё 43 тысячи там без БЖУ вовсе).
 *
 * ПОЧЕМУ НЕ ВЕКТОРНЫЙ ПОИСК. Задача лексическая: «мистраль» должен отличаться от
 * «ясно солнышко», а «молоко 3.2%» от «молоко 1%». Эмбеддинги ищут «похожее по
 * смыслу» и смазывают ровно это различие — то есть возвращают ту самую подмену
 * конкретного продукта родовым, ради которой всё и затевалось. Плюс числа в этом
 * приложении никогда не приходят от модели (docs/nutrition-science.md §1), а RAG
 * втащил бы её обратно в путь, где считаются калории.
 *
 * ИНДЕКС. Прямой перебор 6 тысяч строк на каждый запрос — это сотни тысяч
 * сравнений и десятки миллисекунд в одном потоке. Вместо него инвертированный
 * индекс «основа слова → строки»: кандидатов набираем только по словам запроса
 * (обычно единицы-десятки строк), а ранжируем уже существующим `phraseScore`,
 * который умеет падежи, полуслова и одну опечатку.
 *
 * ЛИЦЕНЗИЯ. Данные OFF — ODbL: атрибуция обязательна, поэтому каждая строка
 * уходит клиенту с `source: 'openfoodfacts'`, ровно как и живой API.
 */

/** Строка файла (ключи короткие — их 6 тысяч, а файл читается на старте). */
interface OffRow {
  n: string;
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

interface Entry {
  /** Показываемое имя: с брендом, если он не входит в само название. */
  name: string;
  /** Нормализованная фраза для ранжирования (название + бренд). */
  key: string;
  per100: Per100;
}

/** Крауд-строка не должна выглядеть увереннее кураторской таблицы. */
const MAX_CONFIDENCE = 0.85;
/** Совпадение по штрихкоду: сам продукт опознан ТОЧНО (код самопроверяемый),
 *  поэтому выше нечёткого имени — но это всё ещё крауд-состав, не измерение. */
const BARCODE_CONFIDENCE = 0.9;
/** Ниже этого фраза считается шумом (тот же порог, что у RU-таблицы). */
const MIN_SCORE = 0.55;
/** Сколько кандидатов отдаём в пикер. */
const MAX_CANDIDATES = 5;
/** Предохранитель: слово вроде «молоко» стоит в тысячах строк — перебирать их
 *  все смысла нет, они всё равно проиграют строкам, где совпало больше слов. */
const MAX_POSTINGS_PER_TOKEN = 400;

function toPer100(row: OffRow): Per100 {
  const minerals: Minerals = {};
  if (typeof row.na === 'number') minerals.na = row.na;
  return {
    source: 'openfoodfacts',
    kcal: row.k,
    prot: row.p,
    fat: row.f,
    carb: row.c,
    ...(row.fi === undefined ? {} : { fiber: row.fi }),
    ...(row.su === undefined ? {} : { sugar: row.su }),
    ...(row.sf === undefined ? {} : { satFat: row.sf }),
    minerals,
  };
}

/** Основы слов фразы — единица индекса (падежи уже свёрнуты). */
function stems(phrase: string): string[] {
  return normalizeName(phrase)
    .split(' ')
    .filter((w) => w.length >= 3)
    .map(stemRu);
}

export class OffLocalProvider implements NutritionProvider {
  readonly name = 'openfoodfacts';
  readonly regions = ['RU', 'US'] as const;

  private readonly entries: Entry[] = [];
  private readonly index = new Map<string, number[]>();

  /**
   * Индекс по штрихкодам — отдельный срез той же выгрузки (весь мир, 2 054 787
   * продуктов). Ищется точным совпадением кода, а не по названию, поэтому живёт
   * рядом, а не внутри текстового индекса.
   */
  private barcodes?: BarcodeIndex;

  constructor(rows: OffRow[], barcodes?: BarcodeIndex) {
    this.barcodes = barcodes;
    for (const row of rows) {
      const brand = row.b?.trim();
      // Бренд дописывается к показываемому имени, только если его там ещё нет:
      // «Овсяные отруби» + «Мистраль» → «Овсяные отруби Мистраль», а уже полное
      // «Творожок Простоквашино» остаётся как есть.
      const nameHasBrand = brand ? normalizeName(row.n).includes(normalizeName(brand)) : true;
      const name = brand && !nameHasBrand ? `${row.n} ${brand}` : row.n;
      const at = this.entries.length;
      this.entries.push({ name, key: normalizeName(name), per100: toPer100(row) });
      for (const stem of new Set(stems(name))) {
        const postings = this.index.get(stem);
        if (postings) postings.push(at);
        else this.index.set(stem, [at]);
      }
    }
  }

  /** Читает файл, приготовленный `scripts/offRuImport.ts`. Битые строки
   *  пропускаются молча: подпорченный артефакт не должен ронять сервер. */
  static fromFile(path: string, barcodes?: BarcodeIndex): OffLocalProvider {
    const rows: OffRow[] = [];
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        const row = JSON.parse(line) as OffRow;
        if (typeof row.n === 'string' && typeof row.k === 'number') rows.push(row);
      } catch {
        // строка мусорная — следующая
      }
    }
    return new OffLocalProvider(rows, barcodes);
  }

  get size(): number {
    return this.entries.length;
  }

  /** Кандидаты по словам запроса — только те строки, где встретилось хотя бы
   *  одно слово, вместо перебора всей базы. */
  private candidates(query: string): Set<number> {
    const out = new Set<number>();
    for (const stem of new Set(stems(query))) {
      const postings = this.index.get(stem);
      if (!postings || postings.length > MAX_POSTINGS_PER_TOKEN) continue;
      for (const at of postings) out.add(at);
    }
    return out;
  }

  private ranked(query: string): { entry: Entry; score: number }[] {
    const normalized = normalizeName(query);
    if (normalized.length === 0) return [];
    const scored: { entry: Entry; score: number }[] = [];
    for (const at of this.candidates(query)) {
      const entry = this.entries[at];
      if (!entry) continue;
      const score = phraseScore(normalized, entry.key);
      if (score >= MIN_SCORE) scored.push({ entry, score });
    }
    // Совпало больше слов — выше; при равенстве короче имя (оно ближе к запросу,
    // а не «то же самое плюс ещё три слова»).
    return scored
      .sort((a, b) => b.score - a.score || a.entry.key.length - b.entry.key.length)
      .slice(0, MAX_CANDIDATES);
  }

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    return (await this.searchMany(name, region))[0] ?? null;
  }

  async searchMany(name: string, _region: Region): Promise<ProviderResult[]> {
    // Штрихкод — не имя, а точный ключ: никакого ранжирования, либо тот самый
    // продукт, либо ничего. Контрольная цифра проверяется внутри индекса, так
    // что искажённый код сюда просто не доходит.
    const byCode = this.barcodes?.lookup(name.trim());
    // Состав есть — отвечаем им. Записи без состава этот путь пропускает: товар
    // опознан, но числа ищет уже маршрут штрихкода, по названию.
    if (byCode?.per100) return [{ per100: byCode.per100, name: byCode.name, confidence: BARCODE_CONFIDENCE }];
    return this.ranked(name).map(({ entry, score }) => ({
      per100: entry.per100,
      name: entry.name,
      confidence: Math.min(MAX_CONFIDENCE, 0.4 + 0.5 * score),
    }));
  }
}
