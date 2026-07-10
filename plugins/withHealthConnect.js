const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

/**
 * Android config plugin that FINISHES the react-native-health-connect setup.
 * The library's bundled expo plugin only adds the ≤Android-13 permission-
 * rationale intent filter to the manifest; two more pieces are required for
 * the permission dialog to open at all (library README, v2+):
 *
 *  1. `HealthConnectPermissionDelegate.setPermissionDelegate(this)` in
 *     `MainActivity.onCreate`. Without it `requestPermission()` dereferences an
 *     uninitialized `lateinit` ActivityResultLauncher and throws — our service
 *     layer catches that and reports «denied», so the system dialog can never
 *     appear (the exact device symptom this plugin fixes).
 *  2. The Android 14+ permission-usage activity-alias (Health Connect is part
 *     of the OS there): the dialog's privacy-policy link resolves through
 *     `VIEW_PERMISSION_USAGE`/`HEALTH_PERMISSIONS`, and Play review requires it.
 *
 * Verify after `npx expo prebuild -p android`: MainActivity.kt gains the import
 * + delegate line, AndroidManifest.xml gains the alias.
 */

const DELEGATE_IMPORT =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const DELEGATE_CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';

function withDelegateInMainActivity(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withHealthConnect: expected a Kotlin MainActivity (Expo SDK 54 template).');
    }
    let src = cfg.modResults.contents;
    if (!src.includes(DELEGATE_IMPORT)) {
      src = src.replace(/^(package .*)$/m, `$1\n\n${DELEGATE_IMPORT}`);
    }
    if (!src.includes(DELEGATE_CALL)) {
      src = src.replace(/(super\.onCreate\([^)]*\)\s*\n)/, `$1    ${DELEGATE_CALL}\n`);
      if (!src.includes(DELEGATE_CALL)) {
        throw new Error('withHealthConnect: could not find super.onCreate(...) in MainActivity.kt.');
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withPermissionUsageAlias(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application && cfg.modResults.manifest.application[0];
    if (!app) throw new Error('withHealthConnect: AndroidManifest has no <application>.');
    const aliases = app['activity-alias'] || [];
    const exists = aliases.some(
      (a) => a.$ && a.$['android:name'] === 'ViewPermissionUsageActivity',
    );
    if (!exists) {
      aliases.push({
        $: {
          'android:name': 'ViewPermissionUsageActivity',
          'android:exported': 'true',
          'android:targetActivity': '.MainActivity',
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } }],
            category: [{ $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } }],
          },
        ],
      });
      app['activity-alias'] = aliases;
    }
    return cfg;
  });
}

module.exports = (config) => withPermissionUsageAlias(withDelegateInMainActivity(config));
