import * as LocalAuthentication from 'expo-local-authentication';

/// Biometric unlock for releasing the E2E master private key (Phase-2 native).
///
/// The contract is deliberately *graceful*: biometrics are a convenience layer on
/// top of the OS secure-store, never a hard wall. If the device has no biometric
/// hardware, nothing is enrolled, or the platform module is missing (Expo Go, web,
/// node/jest), we return `unavailable` and the caller proceeds without a prompt —
/// the key is still protected by the Keychain/Keystore and, on a fresh device, by
/// the recovery phrase / key-file. We only ever *block* on an explicit user
/// failure (`failed`/`cancelled`) when biometrics ARE available and were offered.
///
/// `disableDeviceFallback: false` (the default) lets the OS fall back to the device
/// passcode/PIN after a few failed biometric attempts — that is intentional and the
/// task's "graceful fallback to device passcode".
export type BiometricOutcome =
  | 'success' // authenticated (biometric or the OS passcode fallback)
  | 'unavailable' // no hardware / not enrolled / module missing — caller proceeds
  | 'failed' // available + offered, but the user did not authenticate
  | 'cancelled'; // available + offered, but the user dismissed the prompt

/// Whether this device can actually perform a biometric (or passcode-fallback)
/// check right now. False on web, in Expo Go without the native module, and on
/// devices with nothing enrolled — callers treat that as "no gate".
export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    // Native module absent (Expo Go / web / node) — treat as unavailable.
    return false;
  }
}

/// Prompt the user for Face ID / Touch ID / fingerprint (falling back to the device
/// passcode) before a sensitive key operation. Returns an outcome the caller maps
/// to "proceed" vs "stop": `success` and `unavailable` both mean *proceed*; only
/// `failed`/`cancelled` mean a real, available check was declined.
export async function authenticateForKeyAccess(promptMessage: string): Promise<BiometricOutcome> {
  if (!(await isBiometricAvailable())) return 'unavailable';

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      // Allow the OS passcode/PIN as a fallback after failed biometrics.
      disableDeviceFallback: false,
      cancelLabel: undefined,
    });
    if (result.success) return 'success';
    // `user_cancel` / `system_cancel` / `app_cancel` → cancelled; everything else
    // (lockout, not-recognised, …) is a failure the caller can retry or escalate.
    const error = 'error' in result ? result.error : undefined;
    if (error != null && error.includes('cancel')) return 'cancelled';
    return 'failed';
  } catch {
    // A throw here (e.g. module disappeared mid-call) is treated as unavailable so
    // we never lock the user out of their own data because of a runtime hiccup.
    return 'unavailable';
  }
}
