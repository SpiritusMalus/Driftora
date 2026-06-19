/// Test stub for the native `expo-secure-store` module (mapped in via the jest
/// `moduleNameMapper`). Backs the Keychain/Keystore API with an in-memory map so
/// keystore logic (DB key + E2E master key) is testable in node. `__reset` and
/// `__dump` are test-only helpers (not part of the real API) for asserting what
/// was — and was not — written to secure storage.
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

/// Test-only: clear all stored items between tests.
export function __reset(): void {
  store.clear();
}

/// Test-only: a snapshot of everything currently in secure storage.
export function __dump(): Record<string, string> {
  return Object.fromEntries(store.entries());
}
