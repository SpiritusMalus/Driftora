import { describe, expect, it } from '@jest/globals';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { applySchema } from '@/lib/core/db/init';
import * as schema from '@/lib/core/db/schema';
import { ensureSettings, updateSettings, type SettingsPatch } from '@/lib/core/db/settings';
import { createPlanSettingsSaver, manualTargetPatch } from '@/lib/core/services/planSettingsSaver';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('plan edits survive field and screen lifecycle changes', () => {
  it('persists the last field on exit without requiring its edit-end event', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    try {
      await applySchema((sql) => sqlite.exec(sql));
      await updateSettings(db, { targetCarbG: 270 });
      const saver = createPlanSettingsSaver((patch) => updateSettings(db, patch));
      saver.stage(manualTargetPatch('targetCarbG', 250, 2070, 123));
      // Navigation/background flushes the staged value; no field blur occurs.
      await saver.flush();
      const restored = await ensureSettings(db);
      expect(restored.targetCarbG).toBe(250);
      expect(restored.targetsSetAt).toBe(123);
    } finally {
      sqlite.close();
    }
  });

  it('does not turn merely opening and leaving the screen into a deliberate goal', async () => {
    const writes: SettingsPatch[] = [];
    const saver = createPlanSettingsSaver(async (patch) => { writes.push(patch); });
    await saver.flush();
    expect(writes).toEqual([]);
    expect(saver.state().pending).toBe(false);
  });

  it('does not restore an old focus snapshot over an edit whose write already finished', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    try {
      await applySchema((sql) => sqlite.exec(sql));
      await updateSettings(db, { targetCarbG: 270 });
      const saver = createPlanSettingsSaver((patch) => updateSettings(db, patch));
      // A focus load reads settings, then waits for other screen data.
      const readVersion = saver.revision();
      const oldSnapshot = await ensureSettings(db);
      let shownCarbs = 250;
      saver.stage(manualTargetPatch('targetCarbG', shownCarbs, 2070));
      await saver.flush();
      // The new write can finish before the old focus load gets to hydrate UI.
      expect(saver.state().pending).toBe(false);
      if (saver.canHydrate(readVersion)) shownCarbs = oldSnapshot.targetCarbG;
      expect(shownCarbs).toBe(250);
      expect((await ensureSettings(db)).targetCarbG).toBe(250);
      expect(saver.canHydrate(saver.revision())).toBe(true);
    } finally {
      sqlite.close();
    }
  });

  it('coalesces field, background and navigation flushes and saves newer edits last', async () => {
    const gate = deferred();
    const writes: SettingsPatch[] = [];
    let stored = 270;
    const saver = createPlanSettingsSaver(async (patch) => {
      writes.push(patch);
      if (writes.length === 1) await gate.promise;
      if (patch.targetCarbG != null) stored = patch.targetCarbG;
    });
    saver.stage({ targetCarbG: 250 });
    const first = saver.flush();
    saver.stage({ targetCarbG: 240 });
    const background = saver.flush();
    const leave = saver.flush();
    expect(background).toBe(first);
    expect(leave).toBe(first);
    expect(writes).toHaveLength(1);
    gate.resolve();
    await Promise.all([first, background, leave]);
    expect(writes).toEqual([{ targetCarbG: 250 }, { targetCarbG: 240 }]);
    expect(stored).toBe(240);
    expect(saver.state()).toEqual({ pending: false, saving: false, failed: false });
  });

  it('retains failed edits for retry without overwriting a newer value', async () => {
    const gate = deferred();
    const writes: SettingsPatch[] = [];
    const saver = createPlanSettingsSaver(async (patch) => {
      writes.push(patch);
      if (writes.length === 1) {
        await gate.promise;
        throw new Error('storage unavailable');
      }
    });
    saver.stage({ targetProteinG: 150, targetCarbG: 250 });
    const first = saver.flush();
    saver.stage({ targetCarbG: 240 });
    gate.resolve();
    await expect(first).rejects.toThrow('storage unavailable');
    expect(saver.state()).toEqual({ pending: true, saving: false, failed: true });
    await saver.flush();
    expect(writes[1]).toEqual({ targetProteinG: 150, targetCarbG: 240 });
    expect(saver.state()).toEqual({ pending: false, saving: false, failed: false });
  });

  it('lets applying a plan supersede an earlier manual edit already being saved', async () => {
    const gate = deferred();
    const writes: SettingsPatch[] = [];
    const saver = createPlanSettingsSaver(async (patch) => {
      writes.push(patch);
      if (writes.length === 1) await gate.promise;
    });
    saver.stage({ targetCarbG: 250 });
    const running = saver.flush();
    saver.stage({ targetKcal: 2070, targetProteinG: 129, targetFatG: 69, targetCarbG: 233, targetsSetAt: 10 });
    gate.resolve();
    await running;
    expect(writes.at(-1)).toEqual({ targetKcal: 2070, targetProteinG: 129, targetFatG: 69, targetCarbG: 233, targetsSetAt: 10 });
  });

  it('zero disables the goal consistently and later macro edits do not reactivate it', async () => {
    const sqlite = new BetterSqlite3(':memory:');
    const db = drizzle(sqlite, { schema });
    try {
      await applySchema((sql) => sqlite.exec(sql));
      await updateSettings(db, { targetsSetAt: 100, heightCm: 175, sex: 'male', birthYear: 1990 });
      const saver = createPlanSettingsSaver((patch) => updateSettings(db, patch));
      saver.stage(manualTargetPatch('targetKcal', 0, 0, 200));
      saver.stage(manualTargetPatch('targetCarbG', 250, 0, 201));
      await saver.flush();
      const disabled = await ensureSettings(db);
      expect(disabled.targetKcal).toBe(0);
      expect(disabled.targetsSetAt).toBeNull();
      expect(disabled.targetCarbG).toBe(250);
      saver.stage(manualTargetPatch('targetKcal', 2070, 2070, 300));
      await saver.flush();
      expect((await ensureSettings(db)).targetsSetAt).toBe(300);
    } finally {
      sqlite.close();
    }
  });
});
