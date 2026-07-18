import { translateFoodLabels } from '../llm.js';
import type { MealDraft, NutritionAlternative, Region } from '../types.js';

/**
 * DISPLAY-ONLY localization of English nutrition-DB row labels into Russian.
 *
 * The RU source chain falls through to English DBs (USDA/FatSecret) for the long
 * tail — «каша дружба» → «Rice with Milk», variants «Millet»/«Fish Porridge» —
 * so the honest provenance the card shows reads as English (device feedback
 * 2026-07-18: «лучше бы всё было на русском»). We translate ONLY the human
 * labels (`matched_name`, `alternatives[].name`, search candidate names); the
 * per-100g numbers and the «по базе …» source tag are never touched.
 *
 * Cost control: labels already in Cyrillic are skipped (Skurikhin/curated RU/
 * OFF-RU need no call), the remaining misses go out in ONE batched LLM call per
 * request, and every result is cached by its English string — DB rows recur, so
 * the second sighting of any label is free.
 *
 * ON by default; `TRANSLATE_DB_LABELS=0` (or `false`) is the code-free kill
 * switch. Read at call-time so the switch takes effect on a service restart
 * without a redeploy, and so tests can toggle it per-case.
 */
function enabled(): boolean {
  const v = process.env.TRANSLATE_DB_LABELS;
  return v !== '0' && v !== 'false';
}

/** Insertion-ordered LRU: `en(lowercased)` → `ru`. Mirrors the resolver's cache.
 *  In-memory only (resets on service restart); it refills fast on common foods. */
class Lru {
  private readonly map = new Map<string, string>();
  constructor(private readonly max: number) {}
  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: string): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

const cache = new Lru(4000);

/** Any Cyrillic letter → the label is already Russian, leave it as-is. */
function isCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}

/**
 * Translate a set of labels via cache first, then ONE batched call for the cold
 * misses. Returns a Map from the ORIGINAL label to its Russian form (only entries
 * that actually got a translation appear; everything else stays English). The
 * translator is injectable so the cache/skip/batch logic is testable offline.
 */
export async function translateBatch(
  labels: string[],
  translate: (misses: string[]) => Promise<string[]> = translateFoodLabels,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const misses: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label.length === 0 || isCyrillic(label)) continue;
    const key = label.toLowerCase();
    const hit = cache.get(key);
    if (hit !== undefined) {
      out.set(label, hit);
    } else if (!misses.includes(label)) {
      misses.push(label);
    }
  }
  if (misses.length === 0) return out;

  const translated = await translate(misses);
  for (let i = 0; i < misses.length; i++) {
    const en = misses[i]!;
    const ru = (translated[i] ?? '').trim();
    // translateFoodLabels returns the input unchanged on failure — only cache a
    // genuine translation (non-empty and actually different from the English).
    if (ru.length > 0 && ru.toLowerCase() !== en.toLowerCase()) {
      cache.set(en.toLowerCase(), ru);
      out.set(en, ru);
    }
  }
  return out;
}

/**
 * Localize a parsed meal draft's display labels (matched row + alternatives).
 * No-op unless enabled and the region is RU. Fully defensive: any failure keeps
 * the original English draft rather than dropping the parse.
 */
export async function localizeDraft(draft: MealDraft, region: Region): Promise<MealDraft> {
  if (!enabled() || region !== 'RU') return draft;
  try {
    const labels: string[] = [];
    for (const it of draft.items) {
      if (it.matched_name) labels.push(it.matched_name);
      for (const alt of it.alternatives ?? []) labels.push(alt.name);
    }
    if (labels.length === 0) return draft;
    const map = await translateBatch(labels);
    if (map.size === 0) return draft;
    const items = draft.items.map((it) => {
      const matched = it.matched_name != null ? map.get(it.matched_name) : undefined;
      const alternatives = it.alternatives?.map((alt) => {
        const ru = map.get(alt.name);
        return ru != null ? { ...alt, name: ru } : alt;
      });
      return {
        ...it,
        ...(matched != null ? { matched_name: matched } : {}),
        ...(alternatives != null ? { alternatives } : {}),
      };
    });
    return { ...draft, items };
  } catch {
    return draft;
  }
}

/**
 * Localize a flat list of DB candidates (the manual-search picker). Same rules
 * as the draft path — RU only, behind the flag, English on any failure.
 */
export async function localizeAlternatives(
  list: NutritionAlternative[],
  region: Region,
): Promise<NutritionAlternative[]> {
  if (!enabled() || region !== 'RU' || list.length === 0) return list;
  try {
    const map = await translateBatch(list.map((a) => a.name));
    if (map.size === 0) return list;
    return list.map((a) => {
      const ru = map.get(a.name);
      return ru != null ? { ...a, name: ru } : a;
    });
  } catch {
    return list;
  }
}
