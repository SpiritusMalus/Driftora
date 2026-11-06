const fs = require('node:fs/promises');
const path = require('node:path');
const { withDangerousMod } = require('expo/config-plugins');

const SUPPORTED_VERSION = '4.16.0';
const HEADER_CONFIG_PATH =
  'android/src/main/java/com/swmansion/rnscreens/ScreenStackHeaderConfig.kt';

const ORIGINAL_BLOCK = `    fun onUpdate() {
        val stack = screenStack
        val isTop = stack == null || stack.topScreen == parent

        if (!isAttachedToWindow || !isTop || isDestroyed) {
            return
        }`;

const GUARDED_BLOCK = `    fun onUpdate() {
        val stack = screenStack ?: return
        val isTop = stack.topScreen == parent

        if (!isAttachedToWindow || !isTop || isDestroyed) {
            return
        }`;

function assertSupportedVersion(version) {
  if (version !== SUPPORTED_VERSION) {
    throw new Error(
      `withScreenHeaderLifecycleGuard: expected react-native-screens ${SUPPORTED_VERSION}, found ${version}. ` +
        'Re-evaluate the upstream header lifecycle fix before changing or removing this backport.',
    );
  }
}

function guardScreenHeaderLifecycle(contents, version) {
  assertSupportedVersion(version);
  const originalCount = contents.split(ORIGINAL_BLOCK).length - 1;
  const guardedCount = contents.split(GUARDED_BLOCK).length - 1;

  if (originalCount === 0 && guardedCount === 1) return contents;
  if (originalCount !== 1 || guardedCount !== 0) {
    throw new Error(
      'withScreenHeaderLifecycleGuard: unrecognized ScreenStackHeaderConfig.onUpdate source. ' +
        'Expected exactly one original or already guarded 4.16.0 block; refusing to patch.',
    );
  }

  return contents.replace(ORIGINAL_BLOCK, GUARDED_BLOCK);
}

/**
 * Backport https://github.com/software-mansion/react-native-screens/pull/4498
 * without upgrading Expo SDK 54's native dependency. A removed screen can still
 * receive a Fabric header update while its container is null; the old guard
 * treated that screen as topmost and canNavigateBack() then crashed.
 *
 * Only Android prebuild executes this mod. Loading Expo config does not resolve
 * or modify dependencies. Fresh CI installs and repeated prebuilds get the same
 * guard; a dependency upgrade or changed source must be reviewed explicitly.
 */
function withScreenHeaderLifecycleGuard(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const packageJsonPath = require.resolve('react-native-screens/package.json', {
        paths: [cfg.modRequest.projectRoot],
      });
      const { version } = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      assertSupportedVersion(version);

      const sourcePath = path.join(path.dirname(packageJsonPath), HEADER_CONFIG_PATH);
      const source = await fs.readFile(sourcePath, 'utf8');
      const guarded = guardScreenHeaderLifecycle(source, version);
      if (guarded !== source) await fs.writeFile(sourcePath, guarded, 'utf8');
      return cfg;
    },
  ]);
}

module.exports = withScreenHeaderLifecycleGuard;
module.exports.guardScreenHeaderLifecycle = guardScreenHeaderLifecycle;
