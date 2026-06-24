/**
 * JITAI (just-in-time adaptive intervention) trigger rules — PURE, offline,
 * translation-free. Given today's passive signals and the current time of day,
 * decides whether a gentle movement nudge is warranted and when it should fire.
 * The UI supplies the wording (i18n) and the device schedules delivery; this
 * module only decides *whether* and *what type*.
 *
 * Why JITAI over fixed-time reminders: contextual prompts tied to a real signal
 * beat clock-only reminders (JITAI literature — PMC11583291, PMC12481328,
 * JMIR 2025 e66750), and HealthRoutine already has the passive signal most
 * JITAIs lack (steps on device). Walking raises parasympathetic tone, regulates
 * the HPA axis and lifts mood (PMC11594215) — so a "behind your usual pace,
 * fancy a short walk?" nudge is evidence-aligned, not nagging.
 *
 * Anti-fatigue is a hard requirement (Roadmap §5): we never shame, every nudge
 * is opt-in upstream, and we cap hard (one nudge/day by default). We also only
 * decide *near* the relevant window — a snapshot taken in the morning, when low
 * steps are normal, must not trigger an afternoon nudge. The host recomputes
 * this whenever it reschedules reminders (settings save / app foreground), so as
 * the day unfolds the decision reflects the latest live context.
 *
 * Delivery rides the existing daily-reminder seam (`reminders.ts` →
 * `NotificationService`); see `buildContextNudgeReminders` there.
 */

export type NudgeType = 'mood_walk' | 'afternoon_walk' | 'evening_walk';

export interface NudgeContext {
  /// Local hour (0–23) at the moment the schedule is (re)computed.
  hour: number;
  /// Steps recorded so far today.
  steps: number;
  /// The user's personal step goal (NOT the 10k myth) — the pace reference.
  stepsGoal: number;
  /// Most recent mood check-in today (0–10), or null/undefined if none today.
  mood?: number | null;
  /// A break mutes every nudge (mirrors fixed reminders + auto-wins).
  paused?: boolean;
}

export interface PlannedNudge {
  type: NudgeType;
  /// Local fire time the host should schedule the nudge for, today.
  hour: number;
  minute: number;
}

export interface PlanNudgesOptions {
  /// Hard cap on nudges per day (anti-fatigue). Default 1 (conservative).
  maxPerDay?: number;
}

/// A mood at or below this (0–10 scale) counts as low — pairs with low movement
/// for the gentlest, most-relevant nudge. Deliberately conservative.
const LOW_MOOD = 3;

/// Priority order when the cap forces a choice: an acute low-mood nudge is the
/// most relevant, then the midday "behind pace", then the evening top-up.
const PRIORITY: NudgeType[] = ['mood_walk', 'afternoon_walk', 'evening_walk'];

/// Rough share of a day's steps a typical person has accumulated by [hour].
/// A plain heuristic (active hours ~07:00–22:00), NOT a medical claim — its only
/// job is to stop "you're behind" from firing in the morning, when everyone is.
export function expectedStepFractionByHour(hour: number): number {
  const start = 7;
  const end = 22;
  if (hour <= start) return 0;
  if (hour >= end) return 1;
  return (hour - start) / (end - start);
}

/// True when today's steps are meaningfully below the pace expected by this hour
/// — `slack` (0–1) is how far below the expectation we tolerate before nudging
/// (lower = more sensitive). A zero goal disables the rule (no reference).
function behindPace(ctx: NudgeContext, slack: number): boolean {
  if (ctx.stepsGoal <= 0) return false;
  const expected = expectedStepFractionByHour(ctx.hour) * ctx.stepsGoal;
  return ctx.steps < expected * slack;
}

/// Decides the gentle movement nudges to schedule for the rest of today, given a
/// context snapshot. Pure: same input → same output, no I/O, no Date.now().
/// Returns `[]` freely — when paused, when nothing applies, or outside windows.
export function planNudges(
  ctx: NudgeContext,
  options: PlanNudgesOptions = {},
): PlannedNudge[] {
  if (ctx.paused) return [];

  const candidates: PlannedNudge[] = [];

  // Acute: a low mood logged today + little movement → walking is one of the
  // gentlest, best-evidenced mood levers. Fires soon (within the hour, bounded),
  // not at a fixed slot, because the signal is current.
  if (
    ctx.mood != null &&
    ctx.mood <= LOW_MOOD &&
    ctx.hour >= 9 &&
    ctx.hour <= 19 &&
    behindPace(ctx, 0.7)
  ) {
    candidates.push({ type: 'mood_walk', hour: Math.min(ctx.hour + 1, 20), minute: 0 });
  }

  // Midday "behind your usual pace" → a 10-minute walk, fired at 15:30. Only
  // decided inside the early-afternoon window so a morning snapshot can't trip it.
  if (ctx.hour >= 12 && ctx.hour < 15 && behindPace(ctx, 0.6)) {
    candidates.push({ type: 'afternoon_walk', hour: 15, minute: 30 });
  }

  // Evening top-up: still well short of the personal goal → an easy stroll
  // before the day closes. Decided in the early evening; fires at 19:30.
  if (ctx.hour >= 17 && ctx.hour < 19 && ctx.stepsGoal > 0 && ctx.steps < ctx.stepsGoal * 0.7) {
    candidates.push({ type: 'evening_walk', hour: 19, minute: 30 });
  }

  // Cap (anti-fatigue): keep the highest-priority candidates, in a stable order.
  const cap = Math.max(0, options.maxPerDay ?? 1);
  return PRIORITY.filter((type) => candidates.some((c) => c.type === type))
    .map((type) => candidates.find((c) => c.type === type) as PlannedNudge)
    .slice(0, cap);
}
