import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { PhotoInput } from './foodParser';

/// Max upload dimension (BUILD SPEC §5.3) — downscale to keep uploads small and
/// recognition fast; portion estimation gains nothing from full resolution.
const MAX_WIDTH = 1024;

export type PhotoSource = 'camera' | 'library';

/// Downscale to ≤ MAX_WIDTH and re-encode to JPEG. Re-encoding DROPS all EXIF /
/// metadata (incl. GPS) before the photo ever leaves the device (privacy §2).
async function prepare(uri: string): Promise<PhotoInput> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: MAX_WIDTH } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
  );
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/// Capture or pick a food photo, then prepare it for upload. Returns null if the
/// user cancels or denies permission (caller does nothing — no error surfaced).
export async function capturePhoto(source: PhotoSource): Promise<PhotoInput | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  // `exif: false` is belt-and-suspenders; the JPEG re-encode also strips it.
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);

  if (result.canceled || result.assets.length === 0) return null;
  return prepare(result.assets[0]!.uri);
}
