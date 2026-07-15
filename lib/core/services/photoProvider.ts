import type * as ImageManipulatorNS from 'expo-image-manipulator';
import type * as ImagePickerNS from 'expo-image-picker';

import type { PhotoInput } from './foodParser';
import { deleteTempFile } from './tempFiles';

/// Max upload dimension on the LONGER edge (BUILD SPEC §5.3) — downscale to keep
/// uploads small and recognition fast; portion estimation gains nothing from
/// full resolution. Capping the longer edge (not just width) is what bounds the
/// vision-model token cost: those tokens scale with width×height, so a tall
/// photo with an uncapped height is the real cost leak — not the file's MB
/// (device concern 2026-07-15: «ограничение, чтобы не съедали токены»). At 1024
/// a photo is ≤ ~1.05 MP → ≈1.4k vision tokens worst case, a few hundred KB.
const MAX_EDGE = 1024;

export type PhotoSource = 'camera' | 'library';

/// Outcome of a capture/pick attempt. 'cancelled' is the silent path (user
/// backed out or denied the camera); 'failed' means asset(s) exist but none
/// could be processed — the caller says so instead of a silently dead button.
/// `photos` carries ONE item for the camera and possibly several for a library
/// multi-select (each dish shot separately → its own entry, device feedback
/// 2026-07-15 «сфоткал отдельно все блюда»).
export type CaptureResult = { status: 'ok'; photos: PhotoInput[] } | { status: 'cancelled' } | { status: 'failed' };

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

/// Downscale so the LONGER edge is ≤ MAX_EDGE and re-encode to JPEG. The
/// re-encode is what makes ANY gallery format (HEIC/WebP/PNG/GIF/BMP — whatever
/// the platform decoder reads) uploadable as plain JPEG, and it DROPS all EXIF /
/// metadata (incl. GPS) before the photo ever leaves the device (privacy §2).
/// Uses the picked asset's own dimensions to (a) cap the longer side — bounding
/// total pixels and thus vision tokens even for tall photos — and (b) NOT
/// upscale a photo that's already small (resizing a 400px shot up to 1024 would
/// only inflate the upload for nothing). Falls back to a width cap when the
/// picker didn't report dimensions.
async function prepare(
  asset: { uri: string; width?: number; height?: number },
  M: typeof ImageManipulatorNS,
): Promise<PhotoInput> {
  const w = asset.width ?? 0;
  const h = asset.height ?? 0;
  const actions: ImageManipulatorNS.Action[] =
    w === 0 || h === 0
      ? [{ resize: { width: MAX_EDGE } }] // dimensions unknown → previous behaviour
      : Math.max(w, h) > MAX_EDGE
        ? [{ resize: h > w ? { height: MAX_EDGE } : { width: MAX_EDGE } }]
        : []; // already within the cap on both sides → re-encode only, no upscale
  const result = await M.manipulateAsync(asset.uri, actions, {
    compress: 0.7,
    format: M.SaveFormat.JPEG,
  });
  return { uri: result.uri, mimeType: 'image/jpeg' };
}

/// Capture ONE food photo (camera) or pick SEVERAL (library multi-select), then
/// prepare each for upload. Returns 'cancelled' when the native modules are
/// absent, the user cancels, or the camera permission is denied (caller stays
/// silent — same as before), and 'failed' when the picker crashed or NONE of
/// the picked files could be decoded (rare gallery formats — RAW/TIFF, HEIC on
/// very old Androids). A single undecodable pick inside a batch is skipped, not
/// fatal. The originals are deliberately NOT uploaded as-is on decode failure:
/// the JPEG re-encode is what strips EXIF/GPS (privacy §2). `limit` caps a
/// library multi-select so a runaway selection can't queue hundreds of vision
/// calls; the camera always yields at most one. Multi-select is OPT-IN
/// (`multiple: true`) — a caller that wants a single shot (e.g. one tracker
/// screenshot) leaves it off and gets the old single-pick behaviour.
export async function capturePhoto(
  source: PhotoSource,
  opts: { multiple?: boolean; limit?: number } = {},
): Promise<CaptureResult> {
  const { multiple = false, limit = 10 } = opts;
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

  // Multi-select is a library-only, opt-in affordance (a camera launch shoots
  // one frame). `exif: false` is belt-and-suspenders; the JPEG re-encode also
  // strips it.
  const multi = source === 'library' && multiple;
  const pickerOpts: ImagePickerNS.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
    allowsMultipleSelection: multi,
    selectionLimit: multi ? limit : 1,
  };
  let result: ImagePickerNS.ImagePickerResult;
  try {
    result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(pickerOpts)
        : await ImagePicker.launchImageLibraryAsync(pickerOpts);
  } catch {
    return { status: 'failed' };
  }

  if (result.canceled || result.assets.length === 0) return { status: 'cancelled' };
  const photos: PhotoInput[] = [];
  for (const asset of result.assets) {
    try {
      const photo = await prepare(asset, ImageManipulator);
      // The picker's own cache copy (NOT the gallery original — the picker always
      // copies into the app cache) is spent once re-encoded; don't let one
      // accumulate per photo.
      if (asset.uri !== photo.uri) deleteTempFile(asset.uri);
      photos.push(photo);
    } catch {
      // Skip this one undecodable pick but keep the rest of the batch.
      deleteTempFile(asset.uri);
    }
  }
  return photos.length > 0 ? { status: 'ok', photos } : { status: 'failed' };
}
