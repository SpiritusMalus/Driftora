import i18n from './index';
import { ensureSettings, parseReminderTimes } from '@/lib/core/db/settings';
import { getStepsForDay, dayKey } from '@/lib/core/db/steps';
import { latestMood } from '@/lib/core/db/mood';
import { planNudges } from '@/lib/core/insights/nudgeRules';
import { getNotificationService } from '@/lib/core/services/notificationProvider';
import { buildDailyReminders, buildContextNudgeReminders, rescheduleReminders } from '@/lib/core/services/reminders';

// Rebuild OS notification copy when the language changes, using saved preferences.
// Never ask for a new permission merely because the user changed language.
export async function refreshLocalizedReminders(db: Parameters<typeof ensureSettings>[0]): Promise<void> {
  try {
    const s = await ensureSettings(db);
    const t = i18n.t.bind(i18n);
    const specs = buildDailyReminders(parseReminderTimes(s.reminderTimes), {
      title: t('notifications.reminderTitle'), body: t('notifications.reminderBody'),
    }, s.paused);
    if (s.contextualNudges && !s.paused) {
      const now = new Date();
      const steps = await getStepsForDay(db, now);
      const mood = await latestMood(db);
      const nudges = planNudges({ hour: now.getHours(), steps, stepsGoal: s.stepsGoal,
        mood: mood && dayKey(new Date(mood.ts)) === dayKey(now) ? mood.value : null, paused: s.paused });
      specs.push(...buildContextNudgeReminders(nudges, {
        mood_walk: { title: t('notifications.nudge.moodWalkTitle'), body: t('notifications.nudge.moodWalkBody') },
        afternoon_walk: { title: t('notifications.nudge.afternoonWalkTitle'), body: t('notifications.nudge.afternoonWalkBody') },
        evening_walk: { title: t('notifications.nudge.eveningWalkTitle'), body: t('notifications.nudge.eveningWalkBody') },
      }));
    }
    const service = getNotificationService();
    await service.initialize();
    await rescheduleReminders(service, specs);
  } catch (e) { console.warn('localized reminder refresh failed', e); }
}
