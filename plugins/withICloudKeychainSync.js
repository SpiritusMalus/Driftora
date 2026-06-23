const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * iOS config plugin for Phase-2 native key custody.
 *
 * The E2E master private key is mirrored into iCloud Keychain as a
 * `kSecAttrSynchronizable` item (see modules/platform-key-store). Such items sync
 * across the user's Apple devices WITHOUT a dedicated entitlement — they only need
 * iCloud Keychain to be enabled on the device. We still add the **Keychain Sharing**
 * capability with the app's *own default* access group, which:
 *   - satisfies provisioning/profile setups that expect the capability declared, and
 *   - is safe for `expo-secure-store` (same default group the app already uses).
 *
 * This is intentionally conservative: it does NOT add a custom/shared access group
 * (which could change where existing Keychain items live). If a future need arises
 * to share the keychain with an extension, widen the group here.
 *
 * NOTE: not verified in CI — applied by `expo prebuild` and only exercised in a real
 * dev build. See the Phase-2 native handoff in the Obsidian vault.
 */
const withICloudKeychainSync = (config) => {
  return withEntitlementsPlist(config, (cfg) => {
    const entitlements = cfg.modResults;
    const bundleId =
      (config.ios && config.ios.bundleIdentifier) || 'com.driftora.app';
    const group = `$(AppIdentifierPrefix)${bundleId}`;
    const existing = entitlements['keychain-access-groups'];
    if (!Array.isArray(existing)) {
      entitlements['keychain-access-groups'] = [group];
    } else if (!existing.includes(group)) {
      existing.push(group);
    }
    return cfg;
  });
};

module.exports = withICloudKeychainSync;
