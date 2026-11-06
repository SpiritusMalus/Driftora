import type { SettingsPatch } from '../db/settings';

export interface PlanSaveState {
  pending: boolean;
  saving: boolean;
  failed: boolean;
}

export type ManualTargetKey = 'targetKcal' | 'targetProteinG' | 'targetFatG' | 'targetCarbG';

/// Zero already means "no calorie goal" on Home. Clear the deliberate-goal
/// marker too, so the food day cannot revive a calculated goal from the profile.
export function manualTargetPatch(
  key: ManualTargetKey,
  value: number,
  calorieGoal: number,
  now: number = Date.now(),
): SettingsPatch {
  return { [key]: value, targetsSetAt: calorieGoal > 0 ? now : null };
}

/// Keep edits outside a field's focus lifecycle: Android can hide the keyboard
/// and remove the screen without dispatching its final onEndEditing event.
/// Writes run in order, while edits made during a write remain queued. A failed
/// write is retained for retry, with newer edits winning over the failed values.
export function createPlanSettingsSaver(
  write: (patch: SettingsPatch) => Promise<unknown>,
  onState: (state: PlanSaveState) => void = () => {},
) {
  let pending: SettingsPatch = {};
  let running: Promise<void> | null = null;
  let saving = false;
  let failed = false;
  let version = 0;

  const state = (): PlanSaveState => ({
    pending: saving || Object.keys(pending).length > 0,
    saving,
    failed,
  });
  const emit = () => onState(state());

  function stage(patch: SettingsPatch): void {
    if (Object.keys(patch).length === 0) return;
    version += 1;
    pending = { ...pending, ...patch };
    emit();
  }

  function flush(): Promise<void> {
    if (running) return running;
    if (Object.keys(pending).length === 0) return Promise.resolve();
    saving = true;
    failed = false;
    emit();
    running = (async () => {
      try {
        while (Object.keys(pending).length > 0) {
          const patch = pending;
          pending = {};
          try {
            await write(patch);
          } catch (error) {
            pending = { ...patch, ...pending };
            failed = true;
            throw error;
          }
        }
      } finally {
        running = null;
        saving = false;
        emit();
      }
    })();
    return running;
  }

  // A focus load may finish after a new edit has already been saved. Checking
  // "nothing pending" alone would then replace the visible value with the old
  // settings snapshot. Its version must still match as well.
  const revision = () => version;
  const canHydrate = (readVersion: number) => version === readVersion && !state().pending;
  return { stage, flush, state, revision, canHydrate };
}
