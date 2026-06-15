import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_NAME = 'db_encryption_key_v1';

/// Returns the existing DB encryption key from the OS secure enclave
/// (Keychain / Keystore), or generates and persists a new 256-bit key.
export async function getOrCreateDbKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME);
  if (existing && existing.length > 0) return existing;
  const key = generateKey();
  await SecureStore.setItemAsync(KEY_NAME, key);
  return key;
}

function generateKey(): string {
  const bytes = Crypto.getRandomBytes(32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
