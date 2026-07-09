/**
 * Online workout parser — POSTs `{ text }` to the backend `/workout/parse` and
 * returns structured activities. Symmetric to the food parser, but far simpler:
 * there is NO nutrition resolution and NO offline stub. The model only maps free
 * text → activities (type / minutes / pace); the app computes kcal on-device from
 * the user's weight (MET × kg × h), so no energy numbers ever cross the wire.
 *
 * Fail-safe like the food client: any failure — network, timeout, non-2xx, or a
 * response that doesn't match the contract — resolves to an EMPTY list, never a
 * throw, so the caller just shows "не удалось разобрать" and the chip path stays.
 *
 * HARD CONSENT GATE (mirrors foodParserProvider): the online parser is built only
 * when BOTH `EXPO_PUBLIC_FOOD_API_URL` is set AND the user holds the cross-border
 * AI consent — the SAME `aiFoodParseConsent` fact, since this is the same transfer
 * to the same OpenRouter endpoint. Without it, `getWorkoutParser` returns null and
 * nothing leaves the device.
 */

/** One activity parsed from a free-text description — mirrors server ParsedWorkout. */
export interface ParsedWorkout {
  type: string; // WorkoutType key or 'other'
  name_ru: string;
  minutes: number;
  speed_kmh?: number;
  met?: number;
  confidence: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;

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
    (w.met === undefined || typeof w.met === 'number')
  );
}

export interface WorkoutParser {
  parse(text: string): Promise<ParsedWorkout[]>;
}

class HttpWorkoutParser implements WorkoutParser {
  private readonly endpoint: string;
  private readonly authHeaders: Record<string, string>;

  constructor(base: string, token?: string, private readonly timeoutMs = DEFAULT_TIMEOUT_MS) {
    // Derive the sibling endpoint from the food base URL (…/food/parse → …/workout/parse).
    this.endpoint = /\/food\/parse$/.test(base) ? base.replace(/\/food\/parse$/, '/workout/parse') : `${base}/workout/parse`;
    this.authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  }

  async parse(text: string): Promise<ParsedWorkout[]> {
    if (text.trim().length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const data: unknown = await res.json();
      const workouts = (data as { workouts?: unknown })?.workouts;
      if (!Array.isArray(workouts)) return [];
      return workouts.filter(isParsedWorkout);
    } catch {
      return []; // network error / timeout → nothing parsed, chip path still works
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
  return (_online ??= new HttpWorkoutParser(base, process.env.EXPO_PUBLIC_FOOD_API_TOKEN));
}
