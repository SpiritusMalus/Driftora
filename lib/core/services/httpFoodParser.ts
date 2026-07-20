import type {
  AudioInput,
  FoodParser,
  MealDraft,
  NutrientValues,
  NutritionAlternative,
  NutritionItem,
  NutritionSource,
  Per100,
  PhotoInput,
  Region,
} from './foodParser';

const SOURCES: readonly NutritionSource[] = ['usda', 'skurikhin', 'openfoodfacts', 'apininjas', 'fatsecret', 'label', 'ai_estimate', 'estimate'];
/** Text/search: a typed query is answered in 3–6 s and the user is actively
 *  waiting on it, so the ceiling stays near the answer time — the server gives
 *  this path a tight two-attempt budget of its own (10s + 12s, server
 *  httpTimeout.ts). Better to fail at ~25 s and let them retype than to hold the
 *  screen while a doomed re-roll plays out. */
const DEFAULT_TIMEOUT_MS = 25_000;
/** Photo/audio: the server may spend TWO OpenRouter attempts on one request —
 *  17 s on the first, 26 s on the re-roll when the model falls into a decode
 *  loop — and a packaged product adds a second pass that reads its printed
 *  panel. Measured end-to-end on real photos: ~18 s median, worst observed 36 s.
 *  Hanging up before the server answers is the worst outcome, because the client
 *  then blames the network for what was really a slow but successful parse. */
const UPLOAD_TIMEOUT_MS = 50_000;

function isNutrientValues(v: unknown): v is NutrientValues {
  if (v === null || typeof v !== 'object') return false;
  const n = v as Record<string, unknown>;
  return (
    typeof n.kcal === 'number' &&
    typeof n.prot === 'number' &&
    typeof n.fat === 'number' &&
    typeof n.carb === 'number' &&
    typeof n.minerals === 'object' &&
    n.minerals !== null
  );
}

function isPer100(v: unknown): v is Per100 {
  return isNutrientValues(v) && SOURCES.includes((v as Per100).source);
}

function isItem(v: unknown): v is NutritionItem {
  if (v === null || typeof v !== 'object') return false;
  const i = v as Record<string, unknown>;
  return (
    typeof i.name_ru === 'string' &&
    typeof i.name_en === 'string' &&
    typeof i.grams === 'number' &&
    (i.grams_source === 'estimated' || i.grams_source === 'confirmed') &&
    typeof i.confidence === 'number' &&
    isPer100(i.per100) &&
    isNutrientValues(i.scaled) &&
    typeof i.approximate === 'boolean' &&
    (i.matched_name === undefined || typeof i.matched_name === 'string') &&
    (i.prepared === undefined || typeof i.prepared === 'boolean') &&
    (i.dry_basis === undefined || typeof i.dry_basis === 'boolean') &&
    (i.micros_estimated === undefined || typeof i.micros_estimated === 'boolean') &&
    (i.alternatives === undefined || (Array.isArray(i.alternatives) && i.alternatives.every(isAlternative)))
  );
}

function isAlternative(v: unknown): v is NutritionAlternative {
  if (v === null || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return typeof a.name === 'string' && isPer100(a.per100);
}

/** Structural guard: the backend may be down, stale, or misbehaving. */
function isMealDraft(v: unknown): v is MealDraft {
  if (v === null || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    (d.region === 'RU' || d.region === 'US') &&
    Array.isArray(d.items) &&
    d.items.every(isItem) &&
    isNutrientValues(d.totals) &&
    (d.portion_state === 'estimated' || d.portion_state === 'confirmed') &&
    typeof d.approximate === 'boolean' &&
    typeof d.flags === 'object' &&
    d.flags !== null
  );
}

/**
 * Online food parser — POSTs `{ text, region }` to the food-parse backend (the
 * app's ONLY external network call) and returns a `MealDraft`.
 *
 * On any failure — network error, timeout, non-2xx, or a response that doesn't
 * match the contract — it silently falls back to the offline stub so the
 * food-log screen never breaks (BUILD SPEC §5.3: offline resilience stays).
 */
/**
 * Mark a stub draft as a DEGRADED answer: the user expected the online parser
 * and got the offline fallback instead. The flag is client-only — the screen
 * uses it to say so honestly instead of passing stub numbers off as an AI parse.
 */
function asOfflineFallback(draft: MealDraft): MealDraft {
  return { ...draft, flags: { ...draft.flags, offline_fallback: true } };
}

/**
 * The server ANSWERED — it just could not parse (503 when the model truncates
 * or the provider refuses). Telling the user «нет интернета» here is a lie they
 * can check: the connection is obviously fine, so the app looks broken and the
 * suggested remedy (wait for signal) is useless. Same degraded draft, honest
 * label — retrying in a moment is the thing that actually helps.
 */
function asServerFallback(draft: MealDraft): MealDraft {
  return { ...draft, flags: { ...draft.flags, offline_fallback: true, server_error: true } };
}

/** Derive a sibling endpoint from the text one (/food/parse → /food/parse-<kind>). */
function deriveEndpoint(endpoint: string, kind: 'photo' | 'audio'): string {
  return /\/food\/parse$/.test(endpoint)
    ? endpoint.replace(/\/food\/parse$/, `/food/parse-${kind}`)
    : `${endpoint}-${kind}`;
}

/** Derive the search endpoint from the text one (/food/parse → /food/search). */
function deriveSearchEndpoint(endpoint: string): string {
  return /\/food\/parse$/.test(endpoint) ? endpoint.replace(/\/food\/parse$/, '/food/search') : `${endpoint}-search`;
}

/** Optional endpoint overrides + the static app token (server-side `APP_TOKEN`). */
export interface HttpFoodParserOptions {
  photoEndpoint?: string;
  audioEndpoint?: string;
  searchEndpoint?: string;
  /** When set, every request carries `Authorization: Bearer <token>`. */
  token?: string;
  /** Override the photo/audio upload timeout (defaults to `UPLOAD_TIMEOUT_MS`). */
  uploadTimeoutMs?: number;
}

export class HttpFoodParser implements FoodParser {
  private readonly photoEndpoint: string;
  private readonly audioEndpoint: string;
  private readonly searchEndpoint: string;
  /** Extra headers on every request — `Authorization` when a token is set. */
  private readonly authHeaders: Record<string, string>;
  /** Longer timeout for the slow multipart uploads (photo/audio). */
  private readonly uploadTimeoutMs: number;

  constructor(
    private readonly endpoint: string,
    private readonly fallback: FoodParser,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    opts: HttpFoodParserOptions = {},
  ) {
    this.photoEndpoint = opts.photoEndpoint ?? deriveEndpoint(endpoint, 'photo');
    this.audioEndpoint = opts.audioEndpoint ?? deriveEndpoint(endpoint, 'audio');
    this.searchEndpoint = opts.searchEndpoint ?? deriveSearchEndpoint(endpoint);
    this.authHeaders = opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
    this.uploadTimeoutMs = opts.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
  }

  /**
   * Query the backend's free-text DB search and return ranked candidates. Same
   * fail-safe contract as `parse`: any failure (network, timeout, non-2xx, bad
   * shape) falls back to the offline parser, which returns an empty list.
   */
  async searchFoods(query: string, region: Region): Promise<NutritionAlternative[]> {
    if (query.trim().length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.searchEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders },
        // `ai: true` — reaching THIS (online) parser already means AI consent was
        // granted (getFoodParser returns the offline stub otherwise), so the
        // server may add an ai_estimate row when the DBs come up empty.
        body: JSON.stringify({ query, region, ai: true }),
        signal: controller.signal,
      });
      if (!res.ok) return this.fallback.searchFoods(query, region);
      const data: unknown = await res.json();
      const candidates = (data as { candidates?: unknown })?.candidates;
      if (!Array.isArray(candidates)) return this.fallback.searchFoods(query, region);
      return candidates.filter(isAlternative);
    } catch {
      return this.fallback.searchFoods(query, region);
    } finally {
      clearTimeout(timer);
    }
  }

  async parse(text: string, region: Region): Promise<MealDraft> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders },
        body: JSON.stringify({ text, region }),
        signal: controller.signal,
      });
      if (!res.ok) return asServerFallback(await this.fallback.parse(text, region));
      const data: unknown = await res.json();
      if (!isMealDraft(data)) return asOfflineFallback(await this.fallback.parse(text, region));
      return data;
    } catch {
      // Network error or timeout — stay usable offline.
      return asOfflineFallback(await this.fallback.parse(text, region));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Upload a prepared (downscaled, EXIF-stripped) photo as multipart/form-data
   * and return a `MealDraft`. Same fail-safe contract as `parse`: any failure
   * falls back to the offline parser (which, for photos, yields an empty draft).
   */
  async parsePhoto(photo: PhotoInput, region: Region): Promise<MealDraft> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.uploadTimeoutMs);
    try {
      const form = new FormData();
      form.append('region', region);
      // React Native multipart file shape — { uri, name, type }.
      form.append('image', {
        uri: photo.uri,
        name: 'meal.jpg',
        type: photo.mimeType,
      } as unknown as Blob);

      const res = await fetch(this.photoEndpoint, {
        method: 'POST',
        headers: this.authHeaders,
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) return asServerFallback(await this.fallback.parsePhoto(photo, region));
      const data: unknown = await res.json();
      if (!isMealDraft(data)) return asOfflineFallback(await this.fallback.parsePhoto(photo, region));
      return data;
    } catch {
      return asOfflineFallback(await this.fallback.parsePhoto(photo, region));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Upload a recorded voice clip as multipart/form-data and return a `MealDraft`.
   * Same fail-safe contract as `parsePhoto`: any failure falls back to the offline
   * parser (which, for voice, yields an empty draft → the "add detail" hint).
   */
  async parseAudio(audio: AudioInput, region: Region): Promise<MealDraft> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.uploadTimeoutMs);
    try {
      const form = new FormData();
      form.append('region', region);
      // React Native multipart file shape — { uri, name, type }.
      form.append('audio', {
        uri: audio.uri,
        name: 'meal.m4a',
        type: audio.mimeType,
      } as unknown as Blob);

      const res = await fetch(this.audioEndpoint, {
        method: 'POST',
        headers: this.authHeaders,
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) return asServerFallback(await this.fallback.parseAudio(audio, region));
      const data: unknown = await res.json();
      if (!isMealDraft(data)) return asOfflineFallback(await this.fallback.parseAudio(audio, region));
      return data;
    } catch {
      return asOfflineFallback(await this.fallback.parseAudio(audio, region));
    } finally {
      clearTimeout(timer);
    }
  }
}
