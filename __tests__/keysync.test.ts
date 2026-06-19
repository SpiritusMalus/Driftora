import { beforeEach, describe, expect, it } from '@jest/globals';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import { keyPairMatches } from '@/lib/core/crypto/e2ee';
import {
  BiometricGateError,
  getOrCreateMasterKeyPair,
  hasMasterKey,
  installMasterKeyPair,
  tryRestoreMasterKeyFromPlatform,
  unlockMasterKeyPair,
} from '@/lib/core/db/keystore';
import { authenticateForKeyAccess, isBiometricAvailable } from '@/lib/core/security/biometric';
import {
  __setPlatformKeyStoreForTests,
  CUSTODY_ITEM,
  isPlatformCustodyAvailable,
  type PlatformKeyStoreModule,
} from '@/lib/core/security/platformKeyCustody';

const SecureStoreMock = SecureStore as unknown as { __reset(): void; __dump(): Record<string, string> };
const LAMock = LocalAuthentication as unknown as {
  __reset(): void;
  __setEnrolled(v: boolean): void;
  __setNextResult(r: { success: boolean; error?: string }): void;
};

/// An in-memory fake of the native iCloud-Keychain / Block-Store module so the
/// platform-custody orchestration is testable in node. `kind` mirrors what the real
/// Swift/Kotlin module reports.
function makeFakeCustody(kind: 'icloud' | 'blockstore' = 'icloud'): PlatformKeyStoreModule & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    kind,
    async isAvailableAsync() {
      return true;
    },
    async setItemAsync(key, value) {
      store.set(key, value);
      return true;
    },
    async getItemAsync(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async deleteItemAsync(key) {
      store.delete(key);
    },
  };
}

beforeEach(() => {
  SecureStoreMock.__reset();
  LAMock.__reset();
  __setPlatformKeyStoreForTests(null); // default: no platform custody (Expo Go / web)
});

describe('biometric gate', () => {
  it('reports unavailable when there is no biometric hardware (node default)', async () => {
    expect(await isBiometricAvailable()).toBe(false);
    expect(await authenticateForKeyAccess('unlock')).toBe('unavailable');
  });

  it('returns success when enrolled and the user authenticates', async () => {
    LAMock.__setEnrolled(true);
    LAMock.__setNextResult({ success: true });
    expect(await isBiometricAvailable()).toBe(true);
    expect(await authenticateForKeyAccess('unlock')).toBe('success');
  });

  it('distinguishes a user cancel from a plain failure', async () => {
    LAMock.__setEnrolled(true);
    LAMock.__setNextResult({ success: false, error: 'user_cancel' });
    expect(await authenticateForKeyAccess('unlock')).toBe('cancelled');
    LAMock.__setNextResult({ success: false, error: 'not_recognized' });
    expect(await authenticateForKeyAccess('unlock')).toBe('failed');
  });
});

describe('unlockMasterKeyPair (biometric-gated read)', () => {
  it('does NOT prompt on first run — generates the key without a gate', async () => {
    LAMock.__setEnrolled(true);
    LAMock.__setNextResult({ success: false, error: 'not_recognized' }); // would fail IF prompted
    const pair = await unlockMasterKeyPair('unlock');
    expect(keyPairMatches(pair.privateKey, pair.publicKey)).toBe(true);
    expect(await hasMasterKey()).toBe(true);
  });

  it('passes through when the key exists and biometrics succeed', async () => {
    const created = await getOrCreateMasterKeyPair();
    LAMock.__setEnrolled(true);
    LAMock.__setNextResult({ success: true });
    const pair = await unlockMasterKeyPair('unlock');
    expect(pair).toEqual(created);
  });

  it('throws BiometricGateError when the key exists and the user fails the gate', async () => {
    await getOrCreateMasterKeyPair();
    LAMock.__setEnrolled(true);
    LAMock.__setNextResult({ success: false, error: 'not_recognized' });
    await expect(unlockMasterKeyPair('unlock')).rejects.toBeInstanceOf(BiometricGateError);
  });

  it('proceeds without a gate when biometrics are unavailable (no hardware)', async () => {
    const created = await getOrCreateMasterKeyPair();
    // LA mock stays at "no hardware" → outcome 'unavailable' → proceed.
    const pair = await unlockMasterKeyPair('unlock');
    expect(pair).toEqual(created);
  });
});

describe('platform key custody (iCloud Keychain / Block Store mirror)', () => {
  it('is unavailable when no native module is present', async () => {
    expect(await isPlatformCustodyAvailable()).toBe(false);
  });

  it('mirrors the freshly-generated master key into the platform account', async () => {
    const fake = makeFakeCustody('icloud');
    __setPlatformKeyStoreForTests(fake);
    const pair = await getOrCreateMasterKeyPair();
    // write-through is fire-and-forget; let the microtask flush.
    await Promise.resolve();
    expect(fake.store.get(CUSTODY_ITEM)).toBe(pair.privateKey);
  });

  it('mirrors an installed (recovered) key too', async () => {
    const fake = makeFakeCustody('blockstore');
    const source = await getOrCreateMasterKeyPair();
    SecureStoreMock.__reset();
    __setPlatformKeyStoreForTests(fake);
    await installMasterKeyPair(source.privateKey);
    await Promise.resolve();
    expect(fake.store.get(CUSTODY_ITEM)).toBe(source.privateKey);
  });
});

describe('new-device auto-restore from platform custody', () => {
  it('installs the master key delivered by the platform account — no phrase needed', async () => {
    // Device A generates + mirrors the key.
    const fake = makeFakeCustody('icloud');
    __setPlatformKeyStoreForTests(fake);
    const deviceA = await getOrCreateMasterKeyPair();
    await Promise.resolve();

    // Device B: fresh secure store, same platform account (same fake custody).
    SecureStoreMock.__reset();
    expect(await hasMasterKey()).toBe(false);

    const restored = await tryRestoreMasterKeyFromPlatform();
    expect(restored).not.toBeNull();
    expect(restored?.privateKey).toBe(deviceA.privateKey);
    expect(restored?.publicKey).toBe(deviceA.publicKey);
    expect(await hasMasterKey()).toBe(true);
  });

  it('returns null when nothing has been delivered (→ caller falls back to the phrase)', async () => {
    __setPlatformKeyStoreForTests(makeFakeCustody('icloud')); // available but empty
    expect(await tryRestoreMasterKeyFromPlatform()).toBeNull();
    expect(await hasMasterKey()).toBe(false);
  });

  it('returns null when there is no platform custody at all (cross-ecosystem)', async () => {
    expect(await tryRestoreMasterKeyFromPlatform()).toBeNull();
  });

  it('returns the existing key (no-op) when one is already present locally', async () => {
    const existing = await getOrCreateMasterKeyPair();
    const result = await tryRestoreMasterKeyFromPlatform();
    expect(result).toEqual(existing);
  });

  it('ignores a corrupt mirrored value and lets recovery run', async () => {
    const fake = makeFakeCustody('icloud');
    fake.store.set(CUSTODY_ITEM, 'not-a-valid-base64-key!!!');
    __setPlatformKeyStoreForTests(fake);
    expect(await tryRestoreMasterKeyFromPlatform()).toBeNull();
    expect(await hasMasterKey()).toBe(false);
  });
});
