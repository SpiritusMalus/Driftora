/**
 * Cognitive-distortion taxonomy for the СМЭР diary (Ideas §2: turn the diary
 * from a log into a pattern mirror). A small, standard CBT set (Burns) the user
 * can tag a thought with; the UI shows a "thinking trap of the week".
 *
 * Keys are stable ids stored in the DB; the human names live in i18n
 * (`diary.distortions.<key>`), so the data layer stays translation-free.
 */

export const DISTORTION_KEYS = [
  'all_or_nothing',
  'overgeneralization',
  'mental_filter',
  'disqualifying_positive',
  'mind_reading',
  'fortune_telling',
  'catastrophizing',
  'emotional_reasoning',
  'shoulds',
  'labeling',
  'personalization',
] as const;

export type DistortionKey = (typeof DISTORTION_KEYS)[number];

export function isDistortionKey(value: string): value is DistortionKey {
  return (DISTORTION_KEYS as readonly string[]).includes(value);
}

export interface ThinkingTrap {
  key: DistortionKey;
  count: number;
}

/// The most frequently tagged distortion across the given entries' tag lists,
/// or null if nothing was tagged. Ties break by the canonical `DISTORTION_KEYS`
/// order, so the result is deterministic.
export function thinkingTrapOfWeek(taggedEntries: DistortionKey[][]): ThinkingTrap | null {
  const counts = new Map<DistortionKey, number>();
  for (const tags of taggedEntries) {
    for (const key of tags) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: ThinkingTrap | null = null;
  for (const key of DISTORTION_KEYS) {
    const count = counts.get(key) ?? 0;
    if (count > 0 && (best === null || count > best.count)) best = { key, count };
  }
  return best;
}
