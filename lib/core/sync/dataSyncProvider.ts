import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Data-sync provider seam (platform-native-sync, item 1).
 *
 * The TRANSPORT abstraction for E2E sync. The crypto + DB half lives in
 * `syncClient.ts` (build/seal a snapshot, decrypt/import it); a `DataSyncProvider`
 * is only the dumb pipe that carries an already-sealed `blobB64` + non-secret
 * metadata to and from some store. Concrete transports plug in behind it:
 *   - `icloud`  → CloudKit private database   (item 2, native — owner-gated)
 *   - `drive`   → Google Drive App Data folder (item 4, native — owner-gated)
 *   - `server`  → the legacy FastAPI sync-server (dev-only fallback, see
 *                 `serverDataSyncProvider.ts`; default OFF — item 6)
 *
 * E2E INVARIANT (must hold for every transport): the only things that cross this
 * boundary are (a) OPAQUE CIPHERTEXT — `buildBackupFile` output sealed to the
 * master PUBLIC key — and (b) non-secret METADATA (`updatedAt`/`size`/`deviceId`).
 * The master PRIVATE key never appears in a provider call. A provider that cannot
 * preserve this must not exist.
 *
 * OFF-DEVICE / NOT-YET-BUILT degrades to "unavailable" (mirrors the key-custody
 * seam): in Expo Go, on web, and in node/jest `requireOptionalNativeModule`
 * returns null, so `getPlatformDataSyncProvider()` yields the unavailable provider
 * and callers fall back to the manual backup file + recovery phrase.
 */

/// Non-secret snapshot metadata. `updatedAt` is the client clock at export time and
/// is the last-writer-wins key — a newer `updatedAt` supersedes an older snapshot.
export interface SnapshotMeta {
  updatedAt: string;
  size: number;
  deviceId: string;
}

/// A sealed snapshot as it crosses the provider boundary: opaque ciphertext + meta.
export interface SnapshotPayload {
  blobB64: string;
  meta: SnapshotMeta;
}

/// Which platform transport a provider speaks to. `none` = unavailable (no-op).
export type DataSyncKind = 'icloud' | 'drive' | 'server' | 'none';

/// The transport contract every sync provider implements. Intentionally tiny and
/// content-blind: it never sees plaintext or the private key.
export interface DataSyncProvider {
  readonly kind: DataSyncKind;
  /// True only when this transport can actually push/pull right now (e.g. iCloud
  /// account present, Drive scope granted). Off-device this is always false.
  isAvailableAsync(): Promise<boolean>;
  /// Store the sealed blob (last-writer-wins by `meta.updatedAt`). Returns the
  /// stored metadata (echoed/normalized by the transport).
  pushSnapshot(blobB64: string, meta: SnapshotMeta): Promise<SnapshotMeta>;
  /// Fetch the latest sealed blob, or null when the store has none yet.
  pullSnapshot(): Promise<SnapshotPayload | null>;
}

/// Thrown when a transfer is attempted through a transport that isn't available.
/// Distinct type so callers can tell "no platform cloud here" (→ phrase fallback)
/// apart from a real transport error.
export class DataSyncUnavailableError extends Error {
  constructor(message = 'data-sync: no platform transport available on this device') {
    super(message);
    this.name = 'DataSyncUnavailableError';
  }
}

/**
 * The provider every off-device / not-yet-built path degrades to. `isAvailable`
 * is false, push throws [DataSyncUnavailableError], pull yields null (nothing to
 * restore). Callers treat this as "use the manual backup file + recovery phrase".
 */
export const unavailableDataSyncProvider: DataSyncProvider = {
  kind: 'none',
  async isAvailableAsync() {
    return false;
  },
  async pushSnapshot() {
    throw new DataSyncUnavailableError();
  },
  async pullSnapshot() {
    return null;
  },
};

/// The native module contract the CloudKit (item 2) / Drive App Data (item 4)
/// slices will implement. Same method shape as [DataSyncProvider] minus `kind`.
interface PlatformDataSyncModule {
  kind?: DataSyncKind;
  isAvailableAsync(): Promise<boolean>;
  pushSnapshot(blobB64: string, meta: SnapshotMeta): Promise<SnapshotMeta>;
  pullSnapshot(): Promise<SnapshotPayload | null>;
}

let cachedPlatform: DataSyncProvider | undefined;

/**
 * The platform-native data-sync provider for this device, or the unavailable
 * provider when no native module is linked (every build until items 2/4 land the
 * CloudKit / Drive App Data native modules, plus Expo Go / web / node-jest).
 *
 * Mirrors `platformKeyCustody.getPlatformKeyStore()`: optional native module via
 * `requireOptionalNativeModule`, cached, degrading to "unavailable" so the JS seam
 * is shippable now and lights up automatically once the native side exists.
 */
export function getPlatformDataSyncProvider(): DataSyncProvider {
  if (cachedPlatform) return cachedPlatform;
  const native = requireOptionalNativeModule<PlatformDataSyncModule>('PlatformDataSync');
  if (!native) {
    cachedPlatform = unavailableDataSyncProvider;
    return cachedPlatform;
  }
  cachedPlatform = {
    kind: native.kind ?? 'none',
    isAvailableAsync: () => native.isAvailableAsync(),
    pushSnapshot: (blobB64, meta) => native.pushSnapshot(blobB64, meta),
    pullSnapshot: () => native.pullSnapshot(),
  };
  return cachedPlatform;
}

/// Test seam: drop the cached platform provider so a test can re-resolve it.
export function __resetPlatformDataSyncProviderForTests(): void {
  cachedPlatform = undefined;
}
