import type * as ImageManipulatorNS from 'expo-image-manipulator';
import type * as ImagePickerNS from 'expo-image-picker';

import type { PhotoInput } from './foodParser';
import { deleteTempFile } from './tempFiles';

/// Max upload dimension (BUILD SPEC §5.3) — downscale to keep uploads small and
/// recognition fast; portion estimation gains nothing from full resolution.
const MAX_WIDTH = 1024;

export type PhotoSource = 'camera' | 'library';

/// Outcome of a capture/pick attempt. 'cancelled' is the silent path (user
/// backed out or denied the camera); 'failed' means the photo exists but could
/// not be processed — the caller says so instead of a silently dead button.
export type CaptureResult = { status: 'ok'; photo: PhotoInput } | { status: 'cancelled' } | { status: 'failed' };

/// The native modules are imported LAZILY (same pattern as expoNotifications):
/// a static top-level import would crash the whole food-log screen on a client
/// that lacks them (Expo Go, or a dev build from before they were added). Here
/// they self-degrade — capture returns 'cancelled' and the UI hides the photo button.
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

/// Downscale to ≤ MAX_WIDTH and re-encode to JPEG. The re-encode is what makes
/// ANY gallery format (HEIC/WebP/PNG/GIF/BMP — whatever the platform decoder
/// reads) uploadable as plain JPEG, and it DROPS all EXIF / metadata (incl.
/// GPS) before the photo ever leaves the device (privacy §2).
async function prepare(uri: string, M: typeof ImageManipulatorNS): Promise<PhotoInput> {
  const result = await M.manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: 0.7, format: M.SaveFormat.JPEG },
  );
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/// Capture or pick a food photo, then prepare it for upload. Returns
/// 'cancelled' when the native modules are absent, the user cancels, or the
/// camera permission is denied (caller stays silent — same as before), and
/// 'failed' when the picker crashed or the device decoder couldn't read the
/// picked file (rare gallery formats — RAW/TIFF, HEIC on very old Androids).
/// The original is deliberately NOT uploaded as-is on decode failure: the
/// JPEG re-encode is what strips EXIF/GPS (privacy §2).
export async function capturePhoto(source: PhotoSource): Promise<CaptureResult> {
  const ImagePicker = await pickerMod();
  const ImageManipulator = await manipulatorMod();
  if (!ImagePicker || !ImageManipulator) return { status: 'cancelled' };

  // Only the camera needs a runtime permission. The library opens the system
  // picker (PHPicker / Android Photo Picker / GET_CONTENT), which needs none —
  // gating it on the media-library permission would silently block gallery
  // uploads for anyone who once tapped "deny".
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return { status: 'cancelled' };
  }

  // `exif: false` is belt-and-suspenders; the JPEG re-encode also strips it.
  const opts: ImagePickerNS.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  let result: ImagePickerNS.ImagePickerResult;
  try {
    result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
  } catch {
    return { status: 'failed' };
  }

  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
  const asset = result.assets[0]!;
  try {
    const photo = await prepare(asset.uri, ImageManipulator);
    // The picker's own cache copy (NOT the gallery original — the picker always
    // copies into the app cache) is spent once re-encoded; don't let one
    // accumulate per photo.
    if (asset.uri !== photo.uri) deleteTempFile(asset.uri);
    return { status: 'ok', photo };
  } catch {
    deleteTempFile(asset.uri);
    return { status: 'failed' };
  }
}
