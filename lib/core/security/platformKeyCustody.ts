import { requireOptionalNativeModule } from 'expo-modules-core';

/// Platform-account key custody (Phase-2 native): mirror the E2E master PRIVATE key
/// into the user's Apple / Google account so a new phone *in the same ecosystem*
/// restores it with nothing to remember.
///
///  - iOS  → an iCloud-Keychain-**synchronizable** item (`kSecAttrSynchronizable`),
///           which Apple replicates across devices on the same Apple ID.
///  - Android → Google **Block Store** (`com.google.android.gms.auth.blockstore`)
///           with the end-to-end-encryption flag, restored after Google sign-in.
///
/// This is a *mirror*, not the primary store: the canonical copy still lives in
/// `expo-secure-store` (device-local, biometric-gateable) via `keystore.ts`. The
/// mirror only carries the key to a sibling device; losing it changes nothing,
/// because the recovery phrase / key-file remain the guarantee. All writes here are
/// therefore best-effort and must never throw into the caller.
///
/// The actual Keychain/Block-Store code is a small Expo native module
/// (`modules/platform-key-store`, Swift + Kotlin). It is **optional**: in Expo Go,
/// on web, and in node/jest the module is absent, `requireOptionalNativeModule`
/// returns null, and every function below degrades to "unavailable" so the app
/// keeps working exactly as before.

/// The item name under which the master private key is mirrored. Deliberately
/// distinct from the `expo-secure-store` item (`e2ee_master_key_v1`) so the two
/// stores never collide and can be reasoned about (and revoked) independently.
export const CUSTODY_ITEM = 'e2ee_master_key_sync_v1';

/// Shape of the native module (see `modules/platform-key-store/index.ts`). Kept in
/// one place so the JS contract the Swift/Kotlin code must satisfy is explicit.
export interface PlatformKeyStoreModule {
  /// Which platform store this build wraps — set natively (iOS Swift → 'icloud',
  /// Android Kotlin → 'blockstore'). A module constant, so we can label the UI
  /// without depending on react-native's `Platform` in the (node) test path.
  readonly kind: 'icloud' | 'blockstore';
  /// Whether cloud-backed custody is usable right now (iOS: always; Android: Google
  /// Play services + Block Store present). Used for honest UI copy and to skip work.
  isAvailableAsync(): Promise<boolean>;
  /// Persist `value` under `key` in the cloud-backed store. Resolves true if it was
  /// actually written to the syncing store (false → only a local fallback, or the
  /// platform declined). Must not reject for an ordinary "could not sync".
  setItemAsync(key: string, value: string): Promise<boolean>;
  /// Read a previously-stored value, or null if none (e.g. a fresh device before the
  /// platform has delivered it, or the user never had custody on).
  getItemAsync(key: string): Promise<string | null>;
  /// Remove the mirrored value (used if the user revokes / rotates the key).
  deleteItemAsync(key: string): Promise<void>;
}

// Lazily resolved, with a test seam. `undefined` = not yet looked up; `null` = looked
// up and absent (no native module on this platform/runtime).
let cached: PlatformKeyStoreModule | null | undefined;

function nativeModule(): PlatformKeyStoreModule | null {
  if (cached === undefined) {
    cached = requireOptionalNativeModule<PlatformKeyStoreModule>('PlatformKeyStore');
  }
  return cached;
}

/// Test-only: inject a fake native module (or null to simulate absence) and reset
/// the lazy cache. Not used by app code.
export function __setPlatformKeyStoreForTests(mod: PlatformKeyStoreModule | null): void {
  cached = mod;
}

/// A short tag for the platform doing the custody, for UI copy ("iCloud Keychain" /
/// "Google account"). Null when custody is unavailable on this device/runtime.
export async function platformCustodyKind(): Promise<'icloud' | 'blockstore' | null> {
  const mod = nativeModule();
  if (!mod) return null;
  try {
    if (!(await mod.isAvailableAsync())) return null;
  } catch {
    return null;
  }
  return mod.kind;
}

/// Whether the master key can be mirrored to the platform account right now.
export async function isPlatformCustodyAvailable(): Promise<boolean> {
  return (await platformCustodyKind()) != null;
}

/// Best-effort: mirror the master private key into the platform account. Returns
/// whether it was actually synced. Never throws — a failure just means the user
/// keeps the recovery-phrase fallback (which is the guarantee anyway).
export async function saveMasterKeyToPlatform(privateKeyB64: string): Promise<boolean> {
  const mod = nativeModule();
  if (!mod) return false;
  try {
    if (!(await mod.isAvailableAsync())) return false;
    return await mod.setItemAsync(CUSTODY_ITEM, privateKeyB64);
  } catch {
    return false;
  }
}

/// Best-effort: read a platform-mirrored master private key (base64), or null if
/// none has arrived. The caller validates/installs it via `keystore.installMasterKeyPair`.
export async function restoreMasterKeyFromPlatform(): Promise<string | null> {
  const mod = nativeModule();
  if (!mod) return null;
  try {
    if (!(await mod.isAvailableAsync())) return null;
    const value = await mod.getItemAsync(CUSTODY_ITEM);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/// Best-effort: drop the platform-mirrored copy (key rotation / revoke custody).
export async function clearMasterKeyFromPlatform(): Promise<void> {
  const mod = nativeModule();
  if (!mod) return;
  try {
    await mod.deleteItemAsync(CUSTODY_ITEM);
  } catch {
    // best-effort
  }
}
