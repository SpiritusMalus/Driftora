import type { Minerals, Per100, Region } from '../types.js';
import type { NutritionProvider, ProviderResult } from './provider.js';
import { rankByName, scoreToConfidence } from './scoring.js';

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const SEARCH_URL = 'https://platform.fatsecret.com/rest/server.api';

/**
 * FatSecret Platform API — the broad free-text fallback that closes the RU gap
 * (the Skurikhin table is only ~126 foods; OFF needs a barcode). It serves BOTH
 * regions and localizes results (`region`/`language`), so a plain «борщ» resolves
 * instead of falling to the coarse estimate.
 *
 * HONESTY (§1/§4): FatSecret food data is partly community-contributed, so it is
 * attributed with its own `source: 'fatsecret'` — never laundered as USDA/Skurikhin.
 * Only generic "Per 100g" rows are accepted; per-serving descriptions are skipped
 * (we don't guess the gram basis), so an unparseable row returns null and the
 * resolver chain moves on.
 *
 * Auth is OAuth2 client-credentials (a server-held key pair, no user identity).
 * Disabled (always-null) until both `FATSECRET_CLIENT_ID` and
 * `FATSECRET_CLIENT_SECRET` are configured — same opt-in shape as ApiNinjas.
 */

interface FsFood {
  food_name?: string;
  food_type?: string; // 'Generic' | 'Brand'
  food_description?: string;
}

/** FatSecret returns `food` as a single object OR an array — normalize to a list. */
function allFoods(data: unknown): FsFood[] {
  const foods = (data as { foods?: { food?: FsFood | FsFood[] } } | null)?.foods?.food;
  if (Array.isArray(foods)) return foods;
  if (foods && typeof foods === 'object') return [foods];
  return [];
}

function grab(desc: string, label: string): number | undefined {
  const m = desc.match(new RegExp(`${label}:\\s*([\\d.]+)`, 'i'));
  if (!m) return undefined;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : undefined;
}

/** g/oz/ml → grams (ml treated ≈ g for foods). Null for unknown units. */
function toGrams(value: number, unit: string): number | null {
  const u = unit.toLowerCase();
  if (u === 'g' || u === 'gram' || u === 'grams' || u === 'ml') return value;
  if (u === 'oz') return value * 28.3495;
  return null;
}

/**
 * Grams the description's numbers are stated PER. FatSecret's search rows are
 * either "Per 100g" (basis 100) or "Per <serving>" where the gram weight lives
 * in the description ("Per 1 serving (58 g)") or, for brands, in the food NAME
 * ("Snickers Bar (1.86 oz)"). Returns null when no gram basis is recoverable
 * (e.g. "Per 2 tbsp") — we never guess an unknown serving weight.
 */
function servingGrams(description: string, name: string): number | null {
  if (/per\s*100\s*g/i.test(description)) return 100;
  // "(58 g)" / "(1.86 oz)" / "(250 ml)" in the description's serving, then name.
  const paren = /\(\s*([\d.]+)\s*(g|gram|grams|oz|ml)\s*\)/i;
  // Bare "Per 58 g" with no parens.
  const bare = /per\s+[^-|]*?([\d.]+)\s*(g|gram|grams|oz|ml)\b/i;
  const m = description.match(paren) ?? description.match(bare) ?? name.match(paren);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const grams = toGrams(Number(m[1]), m[2]);
  if (grams == null || !Number.isFinite(grams) || grams < 1 || grams > 2000) return null;
  return grams;
}

/**
 * Parse a FatSecret search description into a per-100g block. Accepts a "Per
 * 100g …" row directly, and a "Per <serving> …" row WHEN the serving's gram
 * weight is recoverable (from the description or the food name) — then the
 * serving's macros are scaled to 100 g. Returns null when the row carries no
 * food (no calories or protein) or the gram basis is unknown. Minerals are
 * absent from the search description → left empty.
 */
export function parsePer100(description: string, name = ''): Per100 | null {
  const grams = servingGrams(description, name);
  if (grams == null) return null;
  const kcal = grab(description, 'Calories');
  const prot = grab(description, 'Protein');
  if ((kcal ?? 0) === 0 && (prot ?? 0) === 0) return null;
  const scale = 100 / grams;
  // 2-decimal keeps a Per-100g row byte-exact (scale 1) and rounds cleanly when
  // a serving is scaled up/down.
  const round2 = (v: number): number => Math.round(v * scale * 100) / 100;
  const minerals: Minerals = {};
  return {
    source: 'fatsecret',
    kcal: Math.round((kcal ?? 0) * scale),
    prot: round2(prot ?? 0),
    fat: round2(grab(description, 'Fat') ?? 0),
    carb: round2(grab(description, 'Carbs') ?? 0),
    minerals,
  };
}

export class FatSecretProvider implements NutritionProvider {
  readonly name = 'fatsecret';
  readonly regions = ['RU', 'US'] as const;
  // FatSecret's free tier is an English/US corpus (Cyrillic queries return 0),
  // so the resolver queries it with the LLM's `name_en` in every region — that's
  // what lets it cover foods the RU table misses (device feedback 2026-07-13).
  readonly queryLang = 'en' as const;

  // Cached client-credentials token; refreshed lazily a touch before it expires.
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  private enabled(): boolean {
    return this.clientId.length > 0 && this.clientSecret.length > 0;
  }

  private async accessToken(): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now() + 5_000) return this.token.value;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=basic',
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!data?.access_token) return null;
    const ttlMs = (typeof data.expires_in === 'number' ? data.expires_in : 86_400) * 1000;
    this.token = { value: data.access_token, expiresAt: Date.now() + ttlMs };
    return this.token.value;
  }

  async search(name: string, region: Region): Promise<ProviderResult | null> {
    return (await this.searchMany(name, region))[0] ?? null;
  }

  /**
   * Ranked candidates, best-first. Scores each result's name against the query
   * and prefers Generic over Brand (scoring.ts), so a plain «творог» doesn't get
   * a branded yogurt as its top match. Rows we can't parse to per-100g are dropped.
   */
  async searchMany(name: string, region: Region): Promise<ProviderResult[]> {
    if (!this.enabled() || name.trim().length === 0) return [];
    const token = await this.accessToken();
    if (!token) return [];

    const url = new URL(SEARCH_URL);
    url.searchParams.set('method', 'foods.search');
    url.searchParams.set('search_expression', name);
    url.searchParams.set('format', 'json');
    url.searchParams.set('max_results', '10');
    // Localized results — RU names + descriptions where FatSecret has them.
    url.searchParams.set('region', region);
    if (region === 'RU') url.searchParams.set('language', 'ru');

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    } catch {
      return [];
    }
    if (!res.ok) return [];

    const data = await res.json().catch(() => null);
    const ranked = rankByName(
      name,
      allFoods(data).map((f) => ({ value: f, name: f.food_name ?? '', foodType: f.food_type })),
    );

    const out: ProviderResult[] = [];
    for (const c of ranked) {
      const per100 = c.value.food_description
        ? parsePer100(c.value.food_description, c.value.food_name ?? '')
        : null;
      if (!per100) continue;
      out.push({ per100, name: c.value.food_name ?? name, confidence: scoreToConfidence(c.score) });
    }
    return out;
  }
}
