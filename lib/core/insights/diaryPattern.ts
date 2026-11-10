/** User-entered whole-number rating. Blank is optional; invalid text stays invalid. */
export function parseDiaryRating(input: string): number | null {
  const value = input.trim();
  if (!/^\d{1,3}$/.test(value)) return null;
  const rating = Number(value);
  return rating <= 100 ? rating : null;
}

export type DiaryStep = {
  key: 'situation' | 'emotions' | 'reaction' | 'thoughts' | 'meaning' | 'coreBelief' | 'evidence' | 'reframe';
  meaningIndex?: number;
};

export type DiaryMode = 'basic' | 'review' | 'meaning';

/** A basic record is complete by itself; extra questions require a choice. */
export function diarySteps(meaningCount: number, mode: DiaryMode = 'basic', includeSelf = false): DiaryStep[] {
  const basic: DiaryStep[] = [
    { key: 'situation' }, { key: 'emotions' }, { key: 'reaction' },
    { key: 'thoughts' },
  ];
  if (mode === 'review') return [...basic, { key: 'evidence' }, { key: 'reframe' }];
  if (mode === 'meaning') return [
    ...basic,
    ...Array.from({ length: Math.max(1, meaningCount) }, (_, meaningIndex): DiaryStep => ({ key: 'meaning', meaningIndex })),
    ...(includeSelf ? [{ key: 'coreBelief' } as DiaryStep] : []),
  ];
  return basic;
}
