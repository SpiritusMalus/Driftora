import type {
  AudioInput,
  FoodParser,
  MealDraft,
  NutrientValues,
  NutritionItem,
  NutritionSource,
  Per100,
  PhotoInput,
  Region,
} from './foodParser';

const SOURCES: readonly NutritionSource[] = ['usda', 'skurikhin', 'openfoodfacts', 'apininjas', 'estimate'];
const DEFAULT_TIMEOUT_MS = 12_000;

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
    typeof i.approximate === 'boolean'
  );
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
/** Derive a sibling endpoint from the text one (/food/parse → /food/parse-<kind>). */
function deriveEndpoint(endpoint: string, kind: 'photo' | 'audio'): string {
  return /\/food\/parse$/.test(endpoint)
    ? endpoint.replace(/\/food\/parse$/, `/food/parse-${kind}`)
    : `${endpoint}-${kind}`;
}

export class HttpFoodParser implements FoodParser {
  private readonly photoEndpoint: string;
  private readonly audioEndpoint: string;

  constructor(
    private readonly endpoint: string,
    private readonly fallback: FoodParser,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    photoEndpoint?: string,
    audioEndpoint?: string,
  ) {
    this.photoEndpoint = photoEndpoint ?? deriveEndpoint(endpoint, 'photo');
    this.audioEndpoint = audioEndpoint ?? deriveEndpoint(endpoint, 'audio');
  }

  async parse(text: string, region: Region): Promise<MealDraft> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, region }),
        signal: controller.signal,
      });
      if (!res.ok) return this.fallback.parse(text, region);
      const data: unknown = await res.json();
      if (!isMealDraft(data)) return this.fallback.parse(text, region);
      return data;
    } catch {
      // Network error or timeout — stay usable offline.
      return this.fallback.parse(text, region);
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
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) return this.fallback.parsePhoto(photo, region);
      const data: unknown = await res.json();
      if (!isMealDraft(data)) return this.fallback.parsePhoto(photo, region);
      return data;
    } catch {
      return this.fallback.parsePhoto(photo, region);
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
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
        body: form,
        signal: controller.signal,
      });
      if (!res.ok) return this.fallback.parseAudio(audio, region);
      const data: unknown = await res.json();
      if (!isMealDraft(data)) return this.fallback.parseAudio(audio, region);
      return data;
    } catch {
      return this.fallback.parseAudio(audio, region);
    } finally {
      clearTimeout(timer);
    }
  }
}
