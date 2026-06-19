import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import {
  generateKeyPair,
  installExpoCryptoRng,
  publicKeyFromPrivateKey,
  type E2EEKeyPair,
} from '../crypto/e2ee';

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

/// Returns the device's portable E2E master keypair, generating and persisting it
/// in expo-secure-store on first use. The private key is the only copy and never
/// leaves secure storage; the public key is what backups are encrypted to.
///
/// ⚠️ Phase-2 seams (intentionally NOT implemented here):
///  - Biometric gating: wrap this read with `expo-local-authentication` so the
///    private key is only released after Face ID / fingerprint.
///  - Platform key custody: persist with `kSecAttrSynchronizable` (iOS iCloud
///    Keychain) / Google Block Store so a new device in the same ecosystem
///    restores the key with nothing to remember.
///  - Recovery export: a recovery phrase / key-file fallback (reuse LawDocs
///    `generateRecoveryPhrase` / `downloadKeyFile`).
/// The seam is deliberately a single function so those can be layered in without
/// touching callers.
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
  return pair;
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
