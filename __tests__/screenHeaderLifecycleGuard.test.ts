import { describe, expect, it } from '@jest/globals';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const withScreenHeaderLifecycleGuard = require('../plugins/withScreenHeaderLifecycleGuard');
const { guardScreenHeaderLifecycle } = withScreenHeaderLifecycleGuard;

// The relevant original 4.16.0 method, surrounded by untouched native source.
const SOURCE = `package com.swmansion.rnscreens

class ScreenStackHeaderConfig {
    fun onUpdate() {
        val stack = screenStack
        val isTop = stack == null || stack.topScreen == parent

        if (!isAttachedToWindow || !isTop || isDestroyed) {
            return
        }

        val activity = screenFragment?.activity as AppCompatActivity? ?: return
        activity.setSupportActionBar(toolbar)
        val actionBar = requireNotNull(activity.supportActionBar)
        actionBar.setDisplayHomeAsUpEnabled(
            screenFragment?.canNavigateBack() == true && !isBackButtonHidden,
        )
    }
}
`;

describe('Android screen header lifecycle backport', () => {
  it('only registers an Android prebuild mod while evaluating config', () => {
    const config = withScreenHeaderLifecycleGuard({ name: 'Fixture', slug: 'fixture' });
    expect(typeof config.mods.android.dangerous).toBe('function');
    expect(config.mods.ios).toBeUndefined();
  });

  it('returns for a detached screen before header/back-state work and preserves the rest', () => {
    const guarded = guardScreenHeaderLifecycle(SOURCE, '4.16.0');

    expect(guarded).toBe(
      SOURCE.replace(
        'val stack = screenStack\n        val isTop = stack == null || stack.topScreen == parent',
        'val stack = screenStack ?: return\n        val isTop = stack.topScreen == parent',
      ),
    );
    expect(guarded.indexOf('screenStack ?: return')).toBeLessThan(
      guarded.indexOf('screenFragment?.canNavigateBack()'),
    );
  });

  it('is idempotent when Android prebuild runs again', () => {
    const once = guardScreenHeaderLifecycle(SOURCE, '4.16.0');
    expect(guardScreenHeaderLifecycle(once, '4.16.0')).toBe(once);
  });

  it('requires the exact reviewed dependency version, even when already guarded', () => {
    const guarded = guardScreenHeaderLifecycle(SOURCE, '4.16.0');
    for (const version of ['4.16.1', '4.29.0', undefined]) {
      expect(() => guardScreenHeaderLifecycle(SOURCE, version)).toThrow(/expected react-native-screens 4\.16\.0/);
      expect(() => guardScreenHeaderLifecycle(guarded, version)).toThrow(/Re-evaluate/);
    }
  });

  it('refuses an unknown, partially changed, or ambiguous native source', () => {
    for (const source of [
      '',
      SOURCE.replace('fun onUpdate()', 'fun updateHeader()'),
      SOURCE.replace('!isAttachedToWindow || !isTop || isDestroyed', '!isAttachedToWindow || !isTop'),
      SOURCE + SOURCE,
      SOURCE + guardScreenHeaderLifecycle(SOURCE, '4.16.0'),
    ]) {
      expect(() => guardScreenHeaderLifecycle(source, '4.16.0')).toThrow(/unrecognized.*onUpdate source/);
    }
  });

  it('patches the dependency resolved from the prebuild project root and can run twice', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'driftora-screen-header-'));
    const packageRoot = join(projectRoot, 'node_modules/react-native-screens');
    const packageJsonPath = join(packageRoot, 'package.json');
    const sourcePath = join(
      packageRoot,
      'android/src/main/java/com/swmansion/rnscreens/ScreenStackHeaderConfig.kt',
    );
    try {
      await mkdir(dirname(sourcePath), { recursive: true });
      await writeFile(packageJsonPath, JSON.stringify({ name: 'react-native-screens', version: '4.16.0' }));
      await writeFile(sourcePath, SOURCE);

      const config = withScreenHeaderLifecycleGuard({ name: 'Fixture', slug: 'fixture' });
      expect(await readFile(sourcePath, 'utf8')).toBe(SOURCE);
      const prebuildConfig = { ...config, modRequest: { projectRoot } };
      await config.mods.android.dangerous(prebuildConfig);
      const once = await readFile(sourcePath, 'utf8');
      expect(once).toBe(guardScreenHeaderLifecycle(SOURCE, '4.16.0'));
      await config.mods.android.dangerous(prebuildConfig);
      expect(await readFile(sourcePath, 'utf8')).toBe(once);

      await writeFile(packageJsonPath, JSON.stringify({ name: 'react-native-screens', version: '4.29.0' }));
      await expect(config.mods.android.dangerous(prebuildConfig)).rejects.toThrow(/Re-evaluate/);
      expect(await readFile(sourcePath, 'utf8')).toBe(once);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
