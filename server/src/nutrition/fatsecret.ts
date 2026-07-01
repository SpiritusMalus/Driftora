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

/**
 * Parse a "Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein:
 * 1.09g" description into a per-100g block. Returns null unless the row is
 * explicitly per-100g and carries calories or protein (a real food). Minerals
 * are absent from the search description → left empty.
 */
export function parsePer100(description: string): Per100 | null {
  if (!/per\s*100\s*g/i.test(description)) return null;
  const kcal = grab(description, 'Calories');
  const prot = grab(description, 'Protein');
  if ((kcal ?? 0) === 0 && (prot ?? 0) === 0) return null;
  const minerals: Minerals = {};
  return {
    source: 'fatsecret',
    kcal: Math.round(kcal ?? 0),
    prot: prot ?? 0,
    fat: grab(description, 'Fat') ?? 0,
    carb: grab(description, 'Carbs') ?? 0,
    minerals,
  };
}

export class FatSecretProvider implements NutritionProvider {
  readonly name = 'fatsecret';
  readonly regions = ['RU', 'US'] as const;

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
      const per100 = c.value.food_description ? parsePer100(c.value.food_description) : null;
      if (!per100) continue;
      out.push({ per100, name: c.value.food_name ?? name, confidence: scoreToConfidence(c.score) });
    }
    return out;
  }
}
