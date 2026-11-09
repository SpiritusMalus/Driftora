import { describe, expect, it } from '@jest/globals';

import type { DiaryEntryView } from '@/lib/core/db/diary';
import { buildDiaryExport, type DiaryExportLabels } from '@/lib/core/insights/diaryExport';

const labels: DiaryExportLabels = {
  title: 'Summary',
  situation: 'Situation',
  thoughts: 'Thoughts',
  thoughtBelief: 'Confidence',
  meaning: 'Meaning',
  coreBelief: 'About me',
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
    thoughtBelief: null,
    meanings: [],
    coreBelief: '',
    reactionBody: '',
    reactionBehavior: '',
    evidenceFor: '',
    evidenceAgainst: '',
    reframe: '',
    moodBefore: null,
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
    expect(text).not.toContain('Confidence');
    expect(text).not.toContain('Meaning');
    expect(text).not.toContain('About me');
  });

  it('exports confidence including zero and preserves the ordered personal meaning chain', () => {
    const text = buildDiaryExport([entry({
      thoughts: 'I can enjoy the snow',
      thoughtBelief: 0,
      meanings: ['A chance for joy', 'Childhood and calm'],
      coreBelief: 'I can enjoy small things',
    })], labels);
    expect(text).toContain('- Confidence: 0%');
    expect(text).toContain('- Meaning 1: A chance for joy\n- Meaning 2: Childhood and calm\n- About me: I can enjoy small things');
    expect(buildDiaryExport([entry({ thoughtBelief: 100 })], labels)).toContain('- Confidence: 100%');
  });

  it('returns the empty label when there are no entries', () => {
    expect(buildDiaryExport([], labels)).toBe('No entries');
  });
});
