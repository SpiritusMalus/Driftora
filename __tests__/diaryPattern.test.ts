import { describe, expect, it } from '@jest/globals';

import { parseDiaryRating } from '@/lib/core/insights/diaryPattern';

describe('user-entered diary ratings', () => {
  it.each([['0', 0], ['37', 37], ['100', 100], [' 82 ', 82]])('accepts %s without changing its value', (input, expected) => {
    expect(parseDiaryRating(input)).toBe(expected);
  });

  it.each(['', ' ', '-1', '101', '1000', '3.5', '3,5', '1e2', '10%', 'strong'])('rejects %j rather than silently substituting a rating', (input) => {
    expect(parseDiaryRating(input)).toBeNull();
  });
});
