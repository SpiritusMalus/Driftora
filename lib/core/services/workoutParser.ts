/**
 * Online workout parser — POSTs to the backend `/workout/parse*` family and
 * returns structured activities. Symmetric to the food parser, but far simpler:
 * there is NO nutrition resolution and NO offline stub. The model only maps
 * input → activities (type / minutes / sets / pace); the app computes kcal
 * on-device from the user's weight (MET × kg × h), so no energy numbers cross
 * the wire — with ONE exception: a fitness-tracker screenshot may carry the
 * tracker's own printed total (`device_kcal`), which is the device's
 * measurement transcribed, not model arithmetic.
 *
 * Fail-safe like the food client: any failure — network, timeout, non-2xx, or a
 * response that doesn't match the contract — resolves to an EMPTY result, never
 * a throw, so the caller just shows "не удалось разобрать" and the chip path stays.
 *
 * HARD CONSENT GATE (mirrors foodParserProvider): the online parser is built only
 * when BOTH `EXPO_PUBLIC_FOOD_API_URL` is set AND the user holds the cross-border
 * AI consent — the SAME `aiFoodParseConsent` fact, since this is the same transfer
 * to the same OpenRouter endpoint. Without it, `getWorkoutParser` returns null and
 * nothing leaves the device.
 */

import type { AudioInput, PhotoInput } from './foodParser';

import { getCachedInstallId } from './installId';

/** One activity parsed from a free-text description — mirrors server ParsedWorkout. */
export interface ParsedWorkout {
  type: string; // WorkoutType key or 'other'
  name_ru: string;
  minutes: number;
  speed_kmh?: number;
  met?: number;
  sets?: number; // strength only — the entry is shown in подходы, not minutes
  /// Strength only, and only when the effort was actually described («тяжёлый
  /// присед»). Absent = no signal, and the app keeps its conservative moderate
  /// MET rather than guessing. Validated against STRENGTH_INTENSITIES on use.
  intensity?: string;
  confidence: number;
}

/**
 * A tracker-screenshot parse: activities plus the tracker's own printed totals.
 * When `device_kcal` is present the caller logs THAT burn («по трекеру»)
 * instead of re-deriving one — the watch measured it, we don't out-guess it.
 */
export interface ParsedWorkoutPhoto {
  workouts: ParsedWorkout[];
  device_kcal?: number;
  device_minutes?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
/** Uploads (screenshot / voice clip) get longer — mirrors the food client. */
const UPLOAD_TIMEOUT_MS = 25_000;

/** Whether an online workout parser is even configured for this build. */
export function isWorkoutParserConfigured(): boolean {
  return !!process.env.EXPO_PUBLIC_FOOD_API_URL;
}

/** Structural guard: the backend may be down, stale, or misbehaving. */
function isParsedWorkout(v: unknown): v is ParsedWorkout {
  if (v === null || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return (
    typeof w.type === 'string' &&
    typeof w.name_ru === 'string' &&
    typeof w.minutes === 'number' &&
    typeof w.confidence === 'number' &&
    (w.speed_kmh === undefined || typeof w.speed_kmh === 'number') &&
    (w.met === undefined || typeof w.met === 'number') &&
    (w.sets === undefined || typeof w.sets === 'number') &&
    (w.intensity === undefined || w.intensity === null || typeof w.intensity === 'string')
  );
}

/** Pull the validated activity list out of any `{ workouts: [...] }` response. */
function workoutsOf(data: unknown): ParsedWorkout[] {
  const workouts = (data as { workouts?: unknown })?.workouts;
  if (!Array.isArray(workouts)) return [];
  return workouts.filter(isParsedWorkout);
}

export interface WorkoutParser {
  parse(text: string): Promise<ParsedWorkout[]>;
  /** Spoken workout → activities. Empty list on any failure. */
  parseAudio(audio: AudioInput): Promise<ParsedWorkout[]>;
  /** Tracker screenshot → activities + the tracker's printed totals. */
  parsePhoto(photo: PhotoInput): Promise<ParsedWorkoutPhoto>;
}

class HttpWorkoutParser implements WorkoutParser {
  private readonly textEndpoint: string;
  private readonly audioEndpoint: string;
  private readonly photoEndpoint: string;
  private readonly authHeaders: Record<string, string>;

  constructor(
    base: string,
    token?: string,
    // Lazy — the install id is minted async at DB init, after this singleton
    // may already exist (same pattern as HttpFoodParserOptions.installId).
    private readonly installId?: () => string | null,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    // Derive the sibling endpoints from the food base URL (…/food/parse → …/workout/parse*).
    const root = /\/food\/parse$/.test(base) ? base.replace(/\/food\/parse$/, '') : base;
    this.textEndpoint = `${root}/workout/parse`;
    this.audioEndpoint = `${root}/workout/parse-audio`;
    this.photoEndpoint = `${root}/workout/parse-photo`;
    this.authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Per-request headers: static auth + the current install id, if minted yet. */
  private headers(): Record<string, string> {
    const id = this.installId?.();
    return id ? { ...this.authHeaders, 'X-Install-Id': id } : { ...this.authHeaders };
  }

  async parse(text: string): Promise<ParsedWorkout[]> {
    if (text.trim().length === 0) return [];
    const data = await this.post(this.textEndpoint, {
      json: { text },
      timeoutMs: this.timeoutMs,
    });
    return workoutsOf(data);
  }

  async parseAudio(audio: AudioInput): Promise<ParsedWorkout[]> {
    const form = new FormData();
    // React Native multipart file shape — { uri, name, type }.
    form.append('audio', { uri: audio.uri, name: 'workout.m4a', type: audio.mimeType } as unknown as Blob);
    const data = await this.post(this.audioEndpoint, { form, timeoutMs: UPLOAD_TIMEOUT_MS });
    return workoutsOf(data);
  }

  async parsePhoto(photo: PhotoInput): Promise<ParsedWorkoutPhoto> {
    const form = new FormData();
    form.append('image', { uri: photo.uri, name: 'workout.jpg', type: photo.mimeType } as unknown as Blob);
    const data = await this.post(this.photoEndpoint, { form, timeoutMs: UPLOAD_TIMEOUT_MS });
    const out: ParsedWorkoutPhoto = { workouts: workoutsOf(data) };
    const d = data as { device_kcal?: unknown; device_minutes?: unknown } | null;
    if (typeof d?.device_kcal === 'number' && d.device_kcal > 0) out.device_kcal = Math.round(d.device_kcal);
    if (typeof d?.device_minutes === 'number' && d.device_minutes > 0) out.device_minutes = Math.round(d.device_minutes);
    return out;
  }

  /** One fail-safe POST: JSON or multipart in, parsed JSON out, null on ANY failure. */
  private async post(
    endpoint: string,
    input: { json?: object; form?: FormData; timeoutMs: number },
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: input.json
          ? { 'Content-Type': 'application/json', ...this.headers() }
          : this.headers(),
        body: input.json ? JSON.stringify(input.json) : input.form,
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return (await res.json()) as unknown;
    } catch {
      return null; // network error / timeout → nothing parsed, chip path still works
    } finally {
      clearTimeout(timer);
    }
  }
}

let _online: HttpWorkoutParser | null = null;

/**
 * Returns the online workout parser when AI is configured AND the user holds the
 * cross-border AI consent; otherwise null (the free-text feature is unavailable
 * and the UI falls back to the chip path). No offline stub — parsing free text is
 * inherently an online capability.
 */
export function getWorkoutParser(aiConsent: boolean): WorkoutParser | null {
  const base = process.env.EXPO_PUBLIC_FOOD_API_URL;
  if (!base || !aiConsent) return null;
  return (_online ??= new HttpWorkoutParser(base, process.env.EXPO_PUBLIC_FOOD_API_TOKEN, getCachedInstallId));
}
