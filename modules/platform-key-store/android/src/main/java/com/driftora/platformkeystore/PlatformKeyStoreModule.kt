package com.driftora.platformkeystore

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android platform-account key custody (Phase-2 native) — PLACEHOLDER.
 *
 * The iOS counterpart (`PlatformKeyStoreModule.swift`) mirrors the E2E master
 * private key into iCloud Keychain so a sibling device restores it with nothing
 * to type. The Android equivalent is meant to use Google **Block Store**
 * (`com.google.android.gms.auth.blockstore`, already wired in `build.gradle`),
 * restored after Google sign-in. That real implementation is owner / two-device
 * work (see `TASK-2026-06-19-p2-native-keysync`) and is **not yet written**.
 *
 * This class exists so Expo autolinking can resolve the Android module declared
 * in `expo-module.config.json` and the app compiles for a release build. It
 * honestly reports custody **unavailable** on Android: `isAvailableAsync` → false,
 * reads → null, writes → false, delete → no-op. Per the JS contract
 * (`lib/core/security/platformKeyCustody.ts`) every caller then degrades to the
 * recovery-phrase fallback — exactly the behaviour before this module compiled.
 * No keys are read or stored here.
 *
 * TO IMPLEMENT real custody: replace the bodies below with Block Store
 * `storeBytes`/`retrieveBytes`/`deleteBytes` (cloud-backup + E2E flag) and verify
 * on two physical devices signed into the same Google account.
 */
class PlatformKeyStoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PlatformKeyStore")

    // Mirrors the iOS "kind" constant; the JS layer uses it only for UI labelling.
    Constants("kind" to "blockstore")

    AsyncFunction("isAvailableAsync") {
      // Block Store custody not implemented yet → honestly unavailable.
      false
    }

    AsyncFunction("setItemAsync") { key: String, value: String ->
      // Nothing is persisted; the caller keeps the recovery-phrase guarantee.
      false
    }

    AsyncFunction("getItemAsync") { key: String ->
      // No mirrored value on Android until Block Store custody lands.
      null as String?
    }

    AsyncFunction("deleteItemAsync") { key: String ->
      // no-op — nothing is stored to remove.
    }
  }
}
