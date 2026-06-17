/**
 * Pure orchestration that turns saved "HH:mm" reminder strings into the daily
 * notification specs the `NotificationService` schedules. Kept separate from the
 * device delivery (expoNotifications.ts) so it stays testable offline — only the
 * actual OS scheduling is device-gated.
 */

import type { NotificationService } from './notifications';
import { parseTimeOfDay } from './reminderSchedule';

export interface DailyReminderSpec {
  id: string;
  hour: number;
  minute: number;
  title: string;
  body: string;
}

/// Turns saved "HH:mm" strings into stable daily-reminder specs. Invalid and
/// duplicate times are dropped; the id is derived from the time so rescheduling
/// the same set is idempotent. When `paused` is true the list is empty — a
/// break mutes reminders (same tone as auto-wins), so the caller just cancels.
export function buildDailyReminders(
  times: string[],
  copy: { title: string; body: string },
  paused = false,
): DailyReminderSpec[] {
  if (paused) return [];
  const seen = new Set<string>();
  const out: DailyReminderSpec[] = [];
  for (const raw of times) {
    const t = parseTimeOfDay(raw);
    if (!t) continue;
    const id = `daily-${String(t.hour).padStart(2, '0')}-${String(t.minute).padStart(2, '0')}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, hour: t.hour, minute: t.minute, title: copy.title, body: copy.body });
  }
  return out;
}

/// Cancels the existing reminders and schedules the current set. Safe to call on
/// every settings save — `buildDailyReminders` ids are stable, so the net effect
/// is the desired set regardless of what was scheduled before.
export async function rescheduleReminders(
  service: NotificationService,
  specs: DailyReminderSpec[],
): Promise<void> {
  await service.cancelAll();
  for (const spec of specs) {
    await service.scheduleDaily(spec);
  }
}
