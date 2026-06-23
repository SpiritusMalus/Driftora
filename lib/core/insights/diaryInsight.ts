/**
 * On-device CBT mirror for the СМЭР diary (A1, owner-decided 2026-06-21:
 * on-device ONLY). Reads the diary's already-structured fields — tagged
 * distortions, named emotions + intensity, mood, reframe, and the free text —
 * and surfaces ONE gentle, distortion-aware suggestion. It is pure rules: no
 * network, no LLM, no I/O. The diary is special-category (mental-health) data
 * and must never leave the device (РКН / 152-ФЗ; see RKN-cross-border-checklist).
 *
 * CBT correctness:
 *  - distortion-awareness + balanced-reframe prompts, NEVER "just think positive"
 *    (toxic positivity is not CBT);
 *  - crisis-aware: if recent text/emotion signals self-harm, the only suggestion
 *    is a supportive one — never a flippant nudge;
 *  - honesty: it only fires with enough signal; "nothing to suggest" (null) is a
 *    valid, common result.
 *
 * The engine returns a typed suggestion KEY (not prose); the UI composes the
 * localized, dismissible copy (same translation-free split as `stepInsight`).
 */

import { isDistortionKey, type DistortionKey } from './distortions';

/// The minimal shape the engine reads — a subset of the stored diary entry, so
/// the insights layer doesn't depend on the db view type. `DiaryEntryView`
/// satisfies this structurally, so callers pass entries straight through.
export interface DiaryInsightEntry {
  situation: string;
  thoughts: string;
  emotions: { name: string; intensity: number }[];
  reframe: string;
  mood: number | null; // 0–10
  distortions: string[];
}

/// A gentle, typed suggestion. The UI maps `kind` (+ params) to localized copy.
export type DiarySuggestion =
  /// Recent text/emotion signals distress that may be self-harm — supportive only.
  | { kind: 'crisis_support' }
  /// One distortion shows up repeatedly — offer a balanced reframe of it.
  | { kind: 'recurring_distortion'; distortion: DistortionKey; count: number }
  /// Several recent entries carry very intense emotions — a gentle reframe nudge.
  | { kind: 'high_intensity_emotion' }
  /// A logged situation/thoughts with no reframe yet — invite the reframe step.
  | { kind: 'missing_reframe' };

/// How many recent entries (newest-first) the engine considers.
export const RECENT_WINDOW = 10;
/// A distortion tagged at least this many times in the window is "recurring".
export const RECURRING_DISTORTION_MIN = 3;
/// An emotion at/above this intensity (0–100) counts as "very intense".
export const HIGH_INTENSITY = 80;
/// This many high-intensity entries in the window trips the gentle nudge.
export const HIGH_INTENSITY_ENTRIES_MIN = 2;

/// Self-harm / crisis cues (ru + en), matched case-insensitively as substrings
/// of the situation/thoughts text. Deliberately a small, high-signal set: the
/// goal is to swap a flippant nudge for a supportive line, not to diagnose. A
/// false positive only ever shows a kind, supportive message — a safe failure.
const CRISIS_PATTERNS: string[] = [
  // ru
  'не хочу жить',
  'не хочется жить',
  'покончить с собой',
  'покончить с жизнью',
  'свести счёты с жизнью',
  'свести счеты с жизнью',
  'убить себя',
  'наложить на себя руки',
  'причинить себе вред',
  'навредить себе',
  'порезать себя',
  'self-harm',
  'self harm',
  'hurt myself',
  'kill myself',
  'end my life',
  'want to die',
  "don't want to live",
  'dont want to live',
  'suicid', // covers suicide / suicidal
  'суицид', // covers суицид / суицидальн…
];

function hasCrisisSignal(entry: DiaryInsightEntry): boolean {
  const haystack = `${entry.situation} ${entry.thoughts}`.toLowerCase();
  return CRISIS_PATTERNS.some((p) => haystack.includes(p));
}

function hasContent(entry: DiaryInsightEntry): boolean {
  return entry.situation.trim().length > 0 || entry.thoughts.trim().length > 0;
}

/// Computes the single most useful suggestion for the recent diary, or null when
/// there is nothing worth saying. `entries` are newest-first (as stored). Pure.
///
/// Priority is safety-first: a crisis signal anywhere in the window wins over
/// every other suggestion. After that, the most actionable CBT prompt.
export function diaryInsight(entries: DiaryInsightEntry[]): DiarySuggestion | null {
  const recent = entries.slice(0, RECENT_WINDOW);
  if (recent.length === 0) return null;

  // 1. Crisis safety — always takes precedence.
  if (recent.some(hasCrisisSignal)) return { kind: 'crisis_support' };

  // 2. A recurring distortion the user already recognises in themselves.
  const counts = new Map<DistortionKey, number>();
  for (const e of recent) {
    for (const tag of e.distortions) {
      if (isDistortionKey(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  let top: { distortion: DistortionKey; count: number } | null = null;
  for (const [distortion, count] of counts) {
    if (count >= RECURRING_DISTORTION_MIN && (top === null || count > top.count)) {
      top = { distortion, count };
    }
  }
  if (top) return { kind: 'recurring_distortion', distortion: top.distortion, count: top.count };

  // 3. Repeated very-intense emotions — a gentle "a reframe can lower the heat".
  const intenseEntries = recent.filter((e) =>
    e.emotions.some((em) => em.intensity >= HIGH_INTENSITY),
  ).length;
  if (intenseEntries >= HIGH_INTENSITY_ENTRIES_MIN) {
    return { kind: 'high_intensity_emotion' };
  }

  // 4. The newest entry has content but no reframe — invite the reframe step.
  const newest = recent[0];
  if (hasContent(newest) && newest.reframe.trim().length === 0) {
    return { kind: 'missing_reframe' };
  }

  return null;
}
