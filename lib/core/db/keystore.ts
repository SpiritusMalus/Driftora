import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import {
  generateKeyPair,
  installExpoCryptoRng,
  publicKeyFromPrivateKey,
  type E2EEKeyPair,
} from '../crypto/e2ee';
import { authenticateForKeyAccess } from '../security/biometric';
import {
  restoreMasterKeyFromPlatform,
  saveMasterKeyToPlatform,
} from '../security/platformKeyCustody';

const KEY_NAME = 'db_encryption_key_v1';
// The portable end-to-end master key (X25519). Stored SEPARATELY from the
// device-local SQLCipher key above: the DB key never leaves the device, while
// this master key is the one a backup is encrypted to (and, in Phase 2, the one
// synced via iCloud Keychain / Google Block Store). Different item key on
// purpose — they have different lifetimes and portability.
const MASTER_KEY_NAME = 'e2ee_master_key_v1';

/// Returns the existing DB encryption key from the OS secure enclave
/// (Keychain / Keystore), or generates and persists a new 256-bit key.
export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing && existing.length > 0) return existing;
  const key = generateKey();
  await SecureStore.setItemAsync(KEY_NAME, key);
  return key;
}

/// The persisted shape of the master key in secure storage: the X25519 keypair
/// (base64) plus the creation timestamp. Only the PRIVATE key is the secret —
/// the public key is stored alongside it purely so reads are cheap (it could be
/// re-derived from the private key at any time).
interface StoredMasterKey {
  privateKey: string; // base64 — the secret; never leaves expo-secure-store
  publicKey: string; // base64 — derivable from privateKey
  createdAt: string; // ISO-8601
}

/// Raised when biometric/passcode authentication was available and offered but the
/// user did not pass it. Distinct from an ordinary error so callers can show a
/// "try again / use your recovery phrase" path rather than a generic failure.
export class BiometricGateError extends Error {
  constructor(public readonly outcome: 'failed' | 'cancelled') {
    super(`biometric authentication ${outcome}`);
    this.name = 'BiometricGateError';
  }
}

/// Returns the device's portable E2E master keypair, generating and persisting it
/// in expo-secure-store on first use. The private key is the only copy on this
/// device and never leaves secure storage; the public key is what backups are
/// encrypted to.
///
/// Phase-2 status:
///  ✅ Recovery export (user-held fallback): a recovery phrase + key-file that wrap
///     this private key (`lib/core/crypto/recovery.ts`, embedded by `backupFile.ts`,
///     surfaced in `app/settings/backup.tsx`). `installMasterKeyPair` is the
///     new-device install path.
///  ✅ Platform custody (this file): on first generation and on install we *mirror*
///     the private key into the user's Apple/Google account
///     (`lib/core/security/platformKeyCustody.ts`) so a sibling device restores it
///     automatically. Best-effort — never blocks key creation.
///  ✅ Biometric gate: `unlockMasterKeyPair` wraps the read with
///     `expo-local-authentication`; first-run generation here is intentionally NOT
///     gated so setup is never blocked.
///
/// This plain accessor does NOT prompt for biometrics — it is for first-run setup
/// and internal/non-sensitive reads. Sensitive flows (backup export, key-file
/// export, restore-decrypt) go through `unlockMasterKeyPair` instead.
export async function getOrCreateMasterKeyPair(): Promise<E2EEKeyPair> {
  // Make sure TweetNaCl draws randomness from expo-crypto on-device (no-op in
  // node/jest, where its default crypto.getRandomValues works). Safe to repeat.
  installExpoCryptoRng();

  const raw = await SecureStore.getItemAsync(MASTER_KEY_NAME);
  if (raw && raw.length > 0) {
    const parsed = safeParseStored(raw);
    if (parsed) {
      return { privateKey: parsed.privateKey, publicKey: parsed.publicKey };
    }
    // Corrupt/legacy value — fall through and regenerate. A backup made with the
    // old key can no longer be restored, which matches the E2E contract (lose the
    // key, lose the data) and only happens if secure storage was tampered with.
  }

  const pair = generateKeyPair();
  const stored: StoredMasterKey = {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    createdAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(MASTER_KEY_NAME, JSON.stringify(stored));
  // Mirror the freshly-minted key into the platform account (iCloud Keychain /
  // Block Store) so a sibling device gets it with nothing to remember. Best-effort
  // and fire-and-forget: a sync failure must not break first-run setup.
  void saveMasterKeyToPlatform(pair.privateKey);
  return pair;
}

/// Biometric-gated read of the existing master keypair — the path sensitive flows
/// use before releasing the private key. Behaviour:
///  - No key yet (fresh install) → generate one (first-run is NOT gated, per task).
///  - Key present + biometrics available → prompt; on success/unavailable proceed,
///    on a real failure/cancel throw `BiometricGateError` so the caller can retry
///    or route the user to their recovery phrase.
///  - Key present + biometrics unavailable (no hardware/enrolment, Expo Go, web) →
///    proceed without a prompt; the key is still protected by the Keychain/Keystore.
export async function unlockMasterKeyPair(biometricReason: string): Promise<E2EEKeyPair> {
  const present = await hasMasterKey();
  if (present) {
    const outcome = await authenticateForKeyAccess(biometricReason);
    if (outcome === 'failed' || outcome === 'cancelled') {
      throw new BiometricGateError(outcome);
    }
  }
  return getOrCreateMasterKeyPair();
}

/// The public half of the master key (base64) — safe to log / display / embed in
/// a backup header. Returns null only if no master key exists yet.
export async function getMasterPublicKey(): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(MASTER_KEY_NAME);
  if (!raw) return null;
  const parsed = safeParseStored(raw);
  if (parsed) return parsed.publicKey;
  return null;
}

/// Whether a master key already lives on this device. Used by restore to decide
/// between same-device decrypt (key present) and new-device recovery (key absent
/// → try platform custody, then ask for the recovery phrase / key-file). A
/// malformed stored value counts as absent — restore will then go through recovery
/// and overwrite it.
export async function hasMasterKey(): Promise<boolean> {
  const raw = await SecureStore.getItemAsync(MASTER_KEY_NAME);
  if (!raw || raw.length === 0) return false;
  return safeParseStored(raw) != null;
}

/// Installs a recovered master keypair into secure-store — the new-device path,
/// after the private key was unwrapped from a backup's recovery header (recovery
/// phrase), read from an imported key-file, or delivered by platform custody.
/// Derives/normalizes the public key from the private key so a key-file missing or
/// mismatched on the public half is healed. After this, `getOrCreateMasterKeyPair`
/// returns the installed pair and existing backups encrypted to it decrypt locally.
///
/// SECURITY: this is the ONLY way the private key enters the device other than
/// fresh generation; the caller must have obtained it from a user-held artefact
/// (phrase-unwrapped blob, key-file, or the user's own Apple/Google account). It is
/// never fetched from an app server.
export async function installMasterKeyPair(privateKeyB64: string): Promise<E2EEKeyPair> {
  installExpoCryptoRng();
  const publicKey = publicKeyFromPrivateKey(privateKeyB64); // throws on a bad key
  const stored: StoredMasterKey = {
    privateKey: privateKeyB64,
    publicKey,
    createdAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(MASTER_KEY_NAME, JSON.stringify(stored));
  // Keep the platform-account mirror in step so this device can re-seed siblings.
  void saveMasterKeyToPlatform(privateKeyB64);
  return { privateKey: privateKeyB64, publicKey };
}

/// New-device auto-restore: if this device has no master key yet, try to pull one
/// from the user's platform account (iCloud Keychain / Google Block Store) and
/// install it — the "remember nothing" path for a same-ecosystem upgrade. Returns
/// the installed pair, or null if no key is present locally OR in platform custody
/// (the caller then falls back to the recovery phrase / key-file). Never throws on
/// an ordinary "nothing there" — a malformed mirrored value is treated as absent.
export async function tryRestoreMasterKeyFromPlatform(): Promise<E2EEKeyPair | null> {
  if (await hasMasterKey()) {
    // Already provisioned — nothing to restore. Return the existing pair so callers
    // can treat "key ready" uniformly.
    return getOrCreateMasterKeyPair();
  }
  const privateKey = await restoreMasterKeyFromPlatform();
  if (!privateKey) return null;
  try {
    return await installMasterKeyPair(privateKey);
  } catch {
    // The mirrored value was not a valid private key — ignore and let recovery run.
    return null;
  }
}

function safeParseStored(raw: string): StoredMasterKey | null {
  try {
    const v = JSON.parse(raw) as Partial<StoredMasterKey>;
    if (typeof v.privateKey !== 'string' || v.privateKey.length === 0) return null;
    const publicKey =
      typeof v.publicKey === 'string' && v.publicKey.length > 0
        ? v.publicKey
        : publicKeyFromPrivateKey(v.privateKey);
    return {
      privateKey: v.privateKey,
      publicKey,
      createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    };
  } catch {
    return null;
  }
}

function generateKey(): string {
  const bytes = Crypto.getRandomBytes(32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
