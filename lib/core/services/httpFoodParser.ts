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

import { setAiQuotaRemaining, setAiQuotaScope, type AiQuotaScope } from './aiQuota';

const SOURCES: readonly NutritionSource[] = ['usda', 'skurikhin', 'openfoodfacts', 'apininjas', 'fatsecret', 'label', 'ai_estimate', 'estimate', 'community'];
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
  // `votes` is optional and only the shared base sets it — a stale server that
  // never heard of it still passes, and a nonsense value is dropped rather than
  // shown as a count.
  if (a.votes !== undefined && (typeof a.votes !== 'number' || !Number.isFinite(a.votes))) return false;
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

/**
 * 429 `ai_quota_exceeded`: this install's AI budget is spent. A narrowing of
 * `offline_fallback` (same pattern as `server_error`) — the connection is fine
 * and an immediate retry is pointless, so the honest message is about the limit,
 * with the manual/chip paths as the remedy. WHICH limit (the free trial, gone
 * for good, or today's paid allowance) comes from the scope header, not from
 * this flag.
 */
function asQuotaFallback(draft: MealDraft): MealDraft {
  return { ...draft, flags: { ...draft.flags, offline_fallback: true, quota_exceeded: true } };
}

/**
 * 401/403: the server refused the app's token. Not a network problem and not
 * something the user can fix — it means this BUILD went out without
 * `EXPO_PUBLIC_FOOD_API_TOKEN`, so every parse in it fails the same way.
 *
 * Worth its own flag precisely because the generic «нет интернета» is so
 * plausible and so wrong: a whole test group would go check their wifi while the
 * real fix is one build setting.
 */
function asAuthFallback(draft: MealDraft): MealDraft {
  return { ...draft, flags: { ...draft.flags, offline_fallback: true, auth_error: true } };
}

/** Credentials rejected — distinguishable from every other non-2xx by status alone. */
function isAuthFailure(res: Response): boolean {
  return res.status === 401 || res.status === 403;
}

/** Detect the quota envelope without assuming a readable body. */
async function isQuotaExceeded(res: Response): Promise<boolean> {
  if (res.status !== 429) return false;
  try {
    const body = (await res.json()) as { error?: { code?: string } };
    return body?.error?.code === 'ai_quota_exceeded';
  } catch {
    return false;
  }
}

/** Read one response header, tolerating response doubles that have none.
 *  Best-effort BY DESIGN: minimal doubles (tests, exotic polyfills) may lack
 *  `headers` — a telemetry helper must never flip a good parse into a fallback,
 *  so it degrades to «no report» instead of throwing. */
function header(res: Response, name: string): string | null {
  return typeof res.headers?.get === 'function' ? res.headers.get(name) : null;
}

/** Which budget the server just metered this call against. */
function captureQuotaScope(res: Response): void {
  const raw = header(res, 'x-ai-quota-scope');
  if (raw === 'total' || raw === 'day') setAiQuotaScope(raw as AiQuotaScope);
}

/** Surface the server's remaining-budget header for the quiet «осталось N» line. */
function captureQuotaRemaining(res: Response): void {
  captureQuotaScope(res);
  const raw = header(res, 'x-ai-quota-remaining');
  if (raw === null) return;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) setAiQuotaRemaining(n);
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

/** Derive the shared-base endpoint from the text one (/food/parse → /food/contribute). */
function deriveContributeEndpoint(endpoint: string): string {
  return /\/food\/parse$/.test(endpoint)
    ? endpoint.replace(/\/food\/parse$/, '/food/contribute')
    : `${endpoint}-contribute`;
}

/** Optional endpoint overrides + the static app token (server-side `APP_TOKEN`). */
export interface HttpFoodParserOptions {
  photoEndpoint?: string;
  audioEndpoint?: string;
  searchEndpoint?: string;
  contributeEndpoint?: string;
  /** When set, every request carries `Authorization: Bearer <token>`. */
  token?: string;
  /** Lazy getter for the per-install id (`X-Install-Id`) — lazy because the id
   *  is minted async at DB init and may appear after this parser is built. */
  installId?: () => string | null;
  /** Override the photo/audio upload timeout (defaults to `UPLOAD_TIMEOUT_MS`). */
  uploadTimeoutMs?: number;
}

export class HttpFoodParser implements FoodParser {
  private readonly photoEndpoint: string;
  private readonly audioEndpoint: string;
  private readonly searchEndpoint: string;
  private readonly contributeEndpoint: string;
  /** Extra headers on every request — `Authorization` when a token is set. */
  private readonly authHeaders: Record<string, string>;
  /** Lazy per-install id for the server's AI-quota meter (may appear late). */
  private readonly installId?: () => string | null;
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
    this.contributeEndpoint = opts.contributeEndpoint ?? deriveContributeEndpoint(endpoint);
    this.authHeaders = opts.token ? { Authorization: `Bearer ${opts.token}` } : {};
    this.installId = opts.installId;
    this.uploadTimeoutMs = opts.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
  }

  /** Per-request headers: static auth + the current install id, if minted yet. */
  private headers(): Record<string, string> {
    const id = this.installId?.();
    return id ? { ...this.authHeaders, 'X-Install-Id': id } : { ...this.authHeaders };
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
        headers: { 'Content-Type': 'application/json', ...this.headers() },
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

  /**
   * Add ONE confirmed food to the SHARED base.
   *
   * The request body is the name, the region and the per-100g MACROS — nothing
   * else, on purpose. Not the meal it came from, not the weight eaten, not the
   * time: the point of the base is the food, and a row in it must not be able to
   * describe the person who logged it. The install id every AI route sends for
   * its quota is deliberately NOT attached here either, so `headers()` is
   * bypassed for the static auth header alone.
   *
   * Total by construction: it resolves on a refusal, a timeout, an error and an
   * offline device alike. This runs AFTER a save the user already completed —
   * their meal is logged either way, and a failed donation is not their problem
   * to see.
   */
  async contributeFood(food: NutritionAlternative, region: Region): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await fetch(this.contributeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders },
        body: JSON.stringify({
          name: food.name,
          region,
          // Macros only. Minerals and vitamins are not sent even when the local
          // row happens to carry them: the base stores none (nobody reads iron
          // off a shawarma), so sending them would only widen what leaves the
          // phone for data that is thrown away on arrival.
          per100: {
            kcal: food.per100.kcal,
            prot: food.per100.prot,
            fat: food.per100.fat,
            carb: food.per100.carb,
            ...(food.per100.fiber === undefined ? {} : { fiber: food.per100.fiber }),
            ...(food.per100.sugar === undefined ? {} : { sugar: food.per100.sugar }),
            ...(food.per100.satFat === undefined ? {} : { satFat: food.per100.satFat }),
          },
        }),
        signal: controller.signal,
      });
    } catch {
      // Nothing to report and nobody to report it to — see the doc comment.
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
        headers: { 'Content-Type': 'application/json', ...this.headers() },
        body: JSON.stringify({ text, region }),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (await isQuotaExceeded(res)) {
          setAiQuotaRemaining(0);
          captureQuotaScope(res);
          return asQuotaFallback(await this.fallback.parse(text, region));
        }
        if (isAuthFailure(res)) return asAuthFallback(await this.fallback.parse(text, region));
        return asServerFallback(await this.fallback.parse(text, region));
      }
      captureQuotaRemaining(res);
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
        headers: this.headers(),
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        if (await isQuotaExceeded(res)) {
          setAiQuotaRemaining(0);
          captureQuotaScope(res);
          return asQuotaFallback(await this.fallback.parsePhoto(photo, region));
        }
        if (isAuthFailure(res)) return asAuthFallback(await this.fallback.parsePhoto(photo, region));
        return asServerFallback(await this.fallback.parsePhoto(photo, region));
      }
      captureQuotaRemaining(res);
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
        headers: this.headers(),
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) {
        if (await isQuotaExceeded(res)) {
          setAiQuotaRemaining(0);
          captureQuotaScope(res);
          return asQuotaFallback(await this.fallback.parseAudio(audio, region));
        }
        if (isAuthFailure(res)) return asAuthFallback(await this.fallback.parseAudio(audio, region));
        return asServerFallback(await this.fallback.parseAudio(audio, region));
      }
      captureQuotaRemaining(res);
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
