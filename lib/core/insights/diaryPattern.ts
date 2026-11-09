/** User-entered whole-number rating. Blank is optional; invalid text stays invalid. */
export function parseDiaryRating(input: string): number | null {
  const value = input.trim();
  if (!/^\d{1,3}$/.test(value)) return null;
  const rating = Number(value);
  return rating <= 100 ? rating : null;
}

export type DiaryStep = {
  key: 'situation' | 'emotions' | 'reaction' | 'thoughts' | 'belief' | 'meaning' | 'coreBelief' | 'evidence' | 'reframe';
  meaningIndex?: number;
};

export function diarySteps(meaningCount: number): DiaryStep[] {
  return [
    { key: 'situation' }, { key: 'emotions' }, { key: 'reaction' },
    { key: 'thoughts' }, { key: 'belief' },
    ...Array.from({ length: meaningCount }, (_, meaningIndex): DiaryStep => ({ key: 'meaning', meaningIndex })),
    { key: 'coreBelief' }, { key: 'evidence' }, { key: 'reframe' },
  ];
}
