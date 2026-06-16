import { describe, expect, it } from '@jest/globals';

import type { DiaryEntryView } from '@/lib/core/db/diary';
import { buildDiaryExport, type DiaryExportLabels } from '@/lib/core/insights/diaryExport';

const labels: DiaryExportLabels = {
  title: 'Summary',
  situation: 'Situation',
  thoughts: 'Thoughts',
  distortions: 'Distortions',
  emotions: 'Emotions',
  reaction: 'Reaction',
  evidenceFor: 'For',
  evidenceAgainst: 'Against',
  reframe: 'Reframe',
  mood: 'Mood',
  empty: 'No entries',
  formatDate: () => '2026-06-17',
  distortionName: (k) => k,
};

function entry(over: Partial<DiaryEntryView> = {}): DiaryEntryView {
  return {
    id: 1,
    ts: new Date(2026, 5, 17, 10),
    situation: '',
    thoughts: '',
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: '',
    mood: null,
    emotions: [],
    distortions: [],
    ...over,
  };
}

describe('buildDiaryExport', () => {
  it('renders a full entry as a labeled block', () => {
    const text = buildDiaryExport(
      [
        entry({
          situation: 'meeting',
          thoughts: 'I failed',
          reactionBody: 'tense',
          reactionBehavior: 'left',
          evidenceFor: 'x',
          evidenceAgainst: 'y',
          reframe: 'one setback',
          mood: 6,
          emotions: [{ name: 'anxiety', intensity: 70 }],
          distortions: ['catastrophizing'],
        }),
      ],
      labels,
    );

    expect(text).toContain('# Summary');
    expect(text).toContain('## 2026-06-17');
    expect(text).toContain('- Situation: meeting');
    expect(text).toContain('- Distortions: catastrophizing');
    expect(text).toContain('- Emotions: anxiety (70)');
    expect(text).toContain('- Reaction: tense / left');
    expect(text).toContain('- Mood: 6/10');
  });

  it('omits empty fields', () => {
    const text = buildDiaryExport([entry({ thoughts: 'only this' })], labels);
    expect(text).toContain('- Thoughts: only this');
    expect(text).not.toContain('Situation');
    expect(text).not.toContain('Mood');
    expect(text).not.toContain('Distortions');
  });

  it('returns the empty label when there are no entries', () => {
    expect(buildDiaryExport([], labels)).toBe('No entries');
  });
});
