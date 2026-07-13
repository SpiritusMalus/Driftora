/**
 * Tiny in-process fuzzy matcher for the RU food tables — the "Elasticsearch
 * behaviours" (word forms, half-typed words, one-typo tolerance, relevance
 * ranking) without the Elasticsearch: the corpus is a few hundred rows, so an
 * O(rows × tokens) scan per query is microseconds and needs no index/infra.
 *
 * Pure + total: no network, never throws. Operates on ALREADY-NORMALIZED text
 * (lowercase, ё→е, punctuation stripped — see `normalizeRu`/`normalizeName`).
 */

/** True when the text contains Cyrillic — an English-only corpus can't match it. */
export function hasCyrillic(s: string): boolean {
  return /[а-яё]/i.test(s);
}

/**
 * Common RU inflectional endings, longest-first (checked in this order so
 * «-ями» wins over «-и»). Deliberately NOT a full Porter stemmer: stripping
 * one ending covers падежи/число for food nouns and adjectives («борща» →
 * «борщ», «гречневой» → «гречнев») while staying predictable.
 */
const ENDINGS = [
  'иями', 'ами', 'ями', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему',
  'ая', 'яя', 'ую', 'юю', 'ое', 'ее', 'ый', 'ий', 'ой', 'ей',
  'ов', 'ев', 'ах', 'ях', 'ам', 'ям', 'ом', 'ем',
  'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь',
];

/** Strip ONE inflectional ending, keeping a stem of ≥ 3 chars («щи» stays «щи»). */
export function stemRu(word: string): string {
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= 3 && word.endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

/**
 * True when `a` and `b` are within ONE Damerau–Levenshtein edit (substitution,
 * insertion, deletion, or adjacent transposition) — the classic single-typo
 * radius. O(len), no DP table.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return withinOneEdit(b, a);
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    // One substitution … or one adjacent transposition.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // One insertion into the shorter string.
  return a.slice(i) === b.slice(i + 1);
}

/**
 * 0..1 quality of one query token against one key token:
 * exact 1 > half-typed prefix 0.85 > same stem (падеж/число) 0.8 >
 * stem prefix 0.7 > one typo 0.6 > no match 0. Fuzzy needs ≥5-char words —
 * short RU words («сок»/«сом») are one edit apart while unrelated.
 */
export function tokenScore(q: string, k: string): number {
  if (q === k) return 1;
  if (q.length >= 3 && k.startsWith(q)) return 0.85;
  const sq = stemRu(q);
  const sk = stemRu(k);
  if (sq === sk) return 0.8;
  if (sq.length >= 3 && sk.startsWith(sq)) return 0.7;
  if (q.length >= 5 && k.length >= 5 && withinOneEdit(sq, sk)) return 0.6;
  return 0;
}

/**
 * 0..1 relevance of a normalized key phrase for a normalized query phrase.
 * Each query token takes its best match among the key tokens; the blend
 * weighs "did we honour what the user typed" (query coverage, 0.7) over
 * "how much of the key is accounted for" (key coverage, 0.3) — so «борщ с
 * мясом» still finds «борщ», plain «борщ» ranks «борщ» above «борщ с мясом»,
 * and an unhonoured qualifier costs more: «сыр лёгкий» → «сыр российский»
 * lands at exactly the 0.5 floor, so a small MIN_SCORE margin drops it.
 */
export function phraseScore(query: string, key: string): number {
  const qt = query.split(' ').filter(Boolean);
  const kt = key.split(' ').filter(Boolean);
  if (qt.length === 0 || kt.length === 0) return 0;

  const keyBest = new Array<number>(kt.length).fill(0);
  let querySum = 0;
  for (const q of qt) {
    let best = 0;
    let bestAt = -1;
    for (const [i, k] of kt.entries()) {
      const s = tokenScore(q, k);
      if (s > best) {
        best = s;
        bestAt = i;
      }
    }
    querySum += best;
    if (bestAt >= 0) keyBest[bestAt] = Math.max(keyBest[bestAt] ?? 0, best);
  }
  const queryCover = querySum / qt.length;
  const keyCover = keyBest.reduce((a, b) => a + b, 0) / kt.length;
  return 0.7 * queryCover + 0.3 * keyCover;
}

/**
 * The query's CONTENT words (≥ 3 chars — skips stopwords «с»/«и»/«на») that no
 * candidate key even loosely matches: the qualifiers the DB silently dropped,
 * e.g. «легкий» in «сыр легкий» when the base holds only generic cheeses.
 * Inputs must be normalized. "Loosely matched" = tokenScore ≥ 0.5 (a stem /
 * prefix / one-typo hit); below that the word landed nowhere. Lets the caller
 * notice «второе слово ушло в никуда» and offer an honest AI estimate.
 */
export function uncoveredQueryWords(query: string, keys: string[]): string[] {
  const qt = query.split(' ').filter((w) => w.length >= 3);
  const keyTokens = keys.flatMap((k) => k.split(' ').filter(Boolean));
  return qt.filter((q) => {
    let best = 0;
    for (const k of keyTokens) {
      const s = tokenScore(q, k);
      if (s > best) best = s;
    }
    return best < 0.5;
  });
}
