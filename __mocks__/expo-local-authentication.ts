/// Test stub for the native `expo-local-authentication` module (mapped in via the
/// jest `moduleNameMapper`). By default it reports NO biometric hardware — which is
/// the truth in node — so the biometric gate degrades to "unavailable" and existing
/// keystore tests are unaffected. `__set*` helpers let a test simulate an enrolled
/// device and a chosen prompt outcome.
let hasHardware = false;
let enrolled = false;
let nextResult: { success: boolean; error?: string } = { success: true };

export async function hasHardwareAsync(): Promise<boolean> {
  return hasHardware;
}

export async function isEnrolledAsync(): Promise<boolean> {
  return enrolled;
}

export async function authenticateAsync(
  _options?: unknown,
): Promise<{ success: boolean; error?: string }> {
  return nextResult;
}

/// Test-only: pretend the device has biometrics enrolled (or not).
export function __setEnrolled(value: boolean): void {
  hasHardware = value;
  enrolled = value;
}

/// Test-only: set what the next `authenticateAsync` returns.
export function __setNextResult(result: { success: boolean; error?: string }): void {
  nextResult = result;
}

/// Test-only: reset to the default "no hardware" state.
export function __reset(): void {
  hasHardware = false;
  enrolled = false;
  nextResult = { success: true };
}
