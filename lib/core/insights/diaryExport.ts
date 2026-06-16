/**
 * Builds a plain-text summary of thought records to share with a therapist
 * (Roadmap v1.2: bridge app ↔ therapist; relatedness leg of SDT).
 *
 * Pure and i18n-free: the caller passes every label (and the date / distortion
 * formatters) so the diary stays on-device until the user explicitly shares.
 * Empty fields are omitted so the summary stays readable.
 */

import type { DiaryEntryView } from '../db/diary';
import type { DistortionKey } from './distortions';

export interface DiaryExportLabels {
  title: string;
  situation: string;
  thoughts: string;
  distortions: string;
  emotions: string;
  reaction: string;
  evidenceFor: string;
  evidenceAgainst: string;
  reframe: string;
  mood: string;
  empty: string;
  formatDate: (d: Date) => string;
  distortionName: (k: DistortionKey) => string;
}

function entryBlock(e: DiaryEntryView, L: DiaryExportLabels): string {
  const lines: string[] = [`## ${L.formatDate(e.ts)}`];
  const add = (label: string, value: string) => {
    if (value.trim().length > 0) lines.push(`- ${label}: ${value.trim()}`);
  };

  add(L.situation, e.situation);
  add(L.thoughts, e.thoughts);
  if (e.distortions.length > 0) {
    add(L.distortions, e.distortions.map(L.distortionName).join(' · '));
  }
  if (e.emotions.length > 0) {
    add(L.emotions, e.emotions.map((em) => `${em.name} (${em.intensity})`).join(', '));
  }
  add(L.reaction, [e.reactionBody, e.reactionBehavior].filter((x) => x.trim().length > 0).join(' / '));
  add(L.evidenceFor, e.evidenceFor);
  add(L.evidenceAgainst, e.evidenceAgainst);
  add(L.reframe, e.reframe);
  if (e.mood != null) add(L.mood, `${e.mood}/10`);

  return lines.join('\n');
}

/// Renders the entries (in the given order) into a shareable text summary, or
/// the `empty` label if there are none.
export function buildDiaryExport(entries: DiaryEntryView[], labels: DiaryExportLabels): string {
  if (entries.length === 0) return labels.empty;
  return [`# ${labels.title}`, '', entries.map((e) => entryBlock(e, labels)).join('\n\n')].join('\n');
}
