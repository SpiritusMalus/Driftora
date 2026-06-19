/// Minimal test stub for `expo-modules-core` (mapped via jest `moduleNameMapper`).
/// The real module pulls in native/ESM setup that the node test transform can't
/// parse; the only symbol our code uses is `requireOptionalNativeModule`, which in
/// node has no native module to find — so it returns null and the platform-custody
/// layer degrades to "unavailable", exactly as on web / in Expo Go. Tests that need
/// a custody module inject one via `__setPlatformKeyStoreForTests` instead.
export function requireOptionalNativeModule<T = unknown>(_name: string): T | null {
  return null;
}

export function requireNativeModule<T = unknown>(name: string): T {
  throw new Error(`requireNativeModule('${name}') is not available in tests`);
}
