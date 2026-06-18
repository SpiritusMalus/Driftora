import type * as ImageManipulatorNS from 'expo-image-manipulator';
import type * as ImagePickerNS from 'expo-image-picker';

import type { PhotoInput } from './foodParser';

/// Max upload dimension (BUILD SPEC §5.3) — downscale to keep uploads small and
/// recognition fast; portion estimation gains nothing from full resolution.
const MAX_WIDTH = 1024;

export type PhotoSource = 'camera' | 'library';

/// The native modules are imported LAZILY (same pattern as expoNotifications):
/// a static top-level import would crash the whole food-log screen on a client
/// that lacks them (Expo Go, or a dev build from before they were added). Here
/// they self-degrade — capture returns null and the UI hides the photo button.
async function pickerMod(): Promise<typeof ImagePickerNS | null> {
  try {
    return await import('expo-image-picker');
  } catch {
    return null;
  }
}

async function manipulatorMod(): Promise<typeof ImageManipulatorNS | null> {
  try {
    return await import('expo-image-manipulator');
  } catch {
    return null;
  }
}

/// Whether on-device photo capture is available (native modules present). The
/// food-log screen uses this to show/hide the photo button.
export async function isPhotoCaptureAvailable(): Promise<boolean> {
  return (await pickerMod()) !== null && (await manipulatorMod()) !== null;
}

/// Downscale to ≤ MAX_WIDTH and re-encode to JPEG. Re-encoding DROPS all EXIF /
/// metadata (incl. GPS) before the photo ever leaves the device (privacy §2).
async function prepare(uri: string, M: typeof ImageManipulatorNS): Promise<PhotoInput> {
  const result = await M.manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: 0.7, format: M.SaveFormat.JPEG },
  );
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/// Capture or pick a food photo, then prepare it for upload. Returns null if the
/// native modules are absent, or the user cancels or denies permission (caller
/// does nothing — no error surfaced).
export async function capturePhoto(source: PhotoSource): Promise<PhotoInput | null> {
  const ImagePicker = await pickerMod();
  const ImageManipulator = await manipulatorMod();
  if (!ImagePicker || !ImageManipulator) return null;

  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  // `exif: false` is belt-and-suspenders; the JPEG re-encode also strips it.
  const opts: ImagePickerNS.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled || result.assets.length === 0) return null;
  return prepare(result.assets[0]!.uri, ImageManipulator);
}
