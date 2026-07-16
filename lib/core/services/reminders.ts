/**
 * Pure orchestration that turns saved "HH:mm" reminder strings into the daily
 * notification specs the `NotificationService` schedules. Kept separate from the
 * device delivery (expoNotifications.ts) so it stays testable offline — only the
 * actual OS scheduling is device-gated.
 */

import type { NudgeType, PlannedNudge } from '../insights/nudgeRules';
import type { NotificationService } from './notifications';
import { parseTimeOfDay } from './reminderSchedule';

export interface DailyReminderSpec {
  id: string;
  hour: number;
  minute: number;
  title: string;
  body: string;
  /// One-shot: fire at the NEXT hour:minute today and never repeat. Context
  /// nudges are computed from the moment's signals, so a repeating trigger
  /// would re-deliver yesterday's context every day until the next reschedule.
  once?: boolean;
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

/// Per-type copy for a context nudge — the UI/i18n layer owns the wording; this
/// service stays translation-free and just carries the chosen strings through.
export type NudgeCopy = Record<NudgeType, { title: string; body: string }>;

/// Turns the planned JITAI nudges (from `planNudges`) into daily-reminder specs
/// that ride the same `NotificationService` seam as fixed-time reminders. The id
/// is derived from the nudge *type* (not the time) so a reschedule with a fresh
/// context replaces the previous nudge instead of stacking a duplicate. Empty
/// when `paused` — a break mutes nudges exactly like fixed reminders (defensive;
/// `planNudges` already returns nothing when paused).
export function buildContextNudgeReminders(
  nudges: PlannedNudge[],
  copy: NudgeCopy,
  paused = false,
): DailyReminderSpec[] {
  if (paused) return [];
  const seen = new Set<NudgeType>();
  const out: DailyReminderSpec[] = [];
  for (const n of nudges) {
    if (seen.has(n.type)) continue;
    seen.add(n.type);
    out.push({
      id: `nudge-${n.type}`,
      hour: n.hour,
      minute: n.minute,
      title: copy[n.type].title,
      body: copy[n.type].body,
      // Nudges carry TODAY's context («сейчас мало шагов») — deliver once, not
      // as a daily repeat that outlives the signal it was planned from.
      once: true,
    });
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
