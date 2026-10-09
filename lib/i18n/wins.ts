import { currentLocale } from './index';
import { AUTO_WIN_PROTEIN_GOAL, AUTO_WIN_STEPS_GOAL, AUTO_WIN_WORKOUT } from '@/lib/core/db/autoWins';
import type { Win } from '@/lib/core/db/schema';

// Auto-awarded messages are app copy; manual celebrations are the user's words.
// Old database rows keep their original text, but known auto kinds render locally.
export function localizedWinMessage(win: Pick<Win, 'kind' | 'message'>, t: (key: string) => string): string {
  const keys: Record<string, string> = {
    [AUTO_WIN_STEPS_GOAL]: 'wins.auto.localizedStepsGoal',
    [AUTO_WIN_PROTEIN_GOAL]: 'wins.auto.localizedProteinGoal',
    [AUTO_WIN_WORKOUT]: 'wins.auto.localizedWorkout',
  };
  const hasRussian = /[А-Яа-яЁё]/.test(win.message);
  const otherLanguage = currentLocale() === 'en' ? hasRussian : !hasRussian && /[a-z]/i.test(win.message);
  return keys[win.kind] && otherLanguage ? t(keys[win.kind]) : win.message;
}
