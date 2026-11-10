import { describe, expect, it } from '@jest/globals';

import { diarySteps, parseDiaryRating } from '@/lib/core/insights/diaryPattern';

describe('user-entered diary ratings', () => {
  it.each([['0', 0], ['37', 37], ['100', 100], [' 82 ', 82]])('accepts %s without changing its value', (input, expected) => {
    expect(parseDiaryRating(input)).toBe(expected);
  });

  it.each(['', ' ', '-1', '101', '1000', '3.5', '3,5', '1e2', '10%', 'strong'])('rejects %j rather than silently substituting a rating', (input) => {
    expect(parseDiaryRating(input)).toBeNull();
  });
});

describe('optional diary paths', () => {
  const keys = (steps: ReturnType<typeof diarySteps>) => steps.map((step) => step.key);
  it('finishes a basic record after four steps even when saved meanings exist', () => {
    expect(keys(diarySteps(3))).toEqual(['situation', 'emotions', 'reaction', 'thoughts']);
  });
  it('offers thought evaluation without deeper personal questions', () => {
    expect(keys(diarySteps(2, 'review')).slice(4)).toEqual(['evidence', 'reframe']);
  });
  it('starts personal meaning with one question, and adds self-reflection only by choice', () => {
    expect(keys(diarySteps(1, 'meaning')).slice(4)).toEqual(['meaning']);
    expect(diarySteps(3, 'meaning', true).slice(4)).toEqual([
      { key: 'meaning', meaningIndex: 0 }, { key: 'meaning', meaningIndex: 1 },
      { key: 'meaning', meaningIndex: 2 }, { key: 'coreBelief' },
    ]);
  });
});
